'use strict';

let json = require('format-json');
let GitHubApi = require('@octokit/rest');
let crypto = require('crypto');
let githubUpdaters = {
    pull_request: updateGitHubPullRequest,
    comment: updateGitHubComment
};

let ghEnforceValidSsl = process.env.NODE_TLS_REJECT_UNAUTHORIZED === 0;

function connect(context) {
    console.log('Connecting to GitHub');
    console.log('GitHub SSL Validation: ' + String(ghEnforceValidSsl));
    let githubOptions = {
        host: process.env.GTM_GITHUB_HOST || 'api.github.com',
        debug: process.env.GTM_GITHUB_DEBUG || false,
        timeout: parseInt(process.env.GTM_GITHUB_TIMEOUT) || 5000,
        pathPrefix: process.env.GTM_GITHUB_PATH_PREFIX || '',
        proxy: process.env.GTM_GITHUB_PROXY || '',
        rejectUnauthorized: ghEnforceValidSsl
    };

    console.log('Creating GitHub API Connection');
    let github = new GitHubApi(githubOptions);

    let token = process.env.GTM_GITHUB_TOKEN;
    if (context) {
        token =
            process.env['GTM_GITHUB_TOKEN_' + context.toUpperCase().replace('-', '_')] || process.env.GTM_GITHUB_TOKEN;
    }

    console.log('Authenticating with GitHub');
    github.authenticate({
        type: 'oauth',
        token: token
    });

    return github;
}

function signRequestBody(key, body) {
    return `sha1=${crypto
        .createHmac('sha1', key)
        .update(body, 'utf-8')
        .digest('hex')}`;
}

function invalidHook(event) {
    let err = null;
    let errMsg = null;
    const token = process.env.GTM_GITHUB_WEBHOOK_SECRET;
    const headers = event.headers;
    const sig = headers['X-Hub-Signature'] || headers['x-hub-signature'];
    const githubEvent = headers['X-GitHub-Event'] || headers['x-github-event'];
    const id = headers['X-GitHub-Delivery'] || headers['x-github-delivery'];
    const calculatedSig = signRequestBody(token, event.body);

    let validators = [
        {
            name: 'github secret',
            check: typeof token !== 'string',
            msg: `Must provide a 'GITHUB_WEBHOOK_SECRET' env variable`
        },
        {
            name: 'X-Hub-Signature',
            check: !sig,
            msg: 'No X-Hub-Signature found on request'
        },
        {
            name: 'X-Github-Event',
            check: !githubEvent,
            msg: 'No X-Github-Event found on request'
        },
        {
            name: 'X-Github-Delivery',
            check: !id,
            msg: 'No X-Github-Delivery found on request'
        },
        {
            name: 'X-Hub-Signature signing',
            check: sig !== calculatedSig,
            msg: `X-Hub-Signature incorrect. Github webhook token doesn't match`
        }
    ];

    try {
        validators.forEach(v => {
            if (v.check) {
                errMsg = v.msg;
                throw new Error(errMsg);
            }
            console.log(v.name + ' is ok!');
        });
    } catch (e) {
        console.log(e.message);
        err = e;
    }

    return err;
}

function decodeFileResponse(fileResponse) {
    console.log(json.plain(fileResponse));
    let buff = new Buffer(fileResponse.data.content, 'base64');
    let content = JSON.parse(buff.toString('ascii'));

    return content;
}

async function getFile(params) {
    let github = connect();

    return new Promise((resolve, reject) => {
        try {
            let response = github.repos.getContent(params);
            return resolve(response);
        } catch (err) {
            return reject(err);
        }
    });
}

async function updateGitHubPullRequest(status, done) {
    if (status.context === 'COMMENT_ONLY') {
        return await addGitHubPullRequestComment(status, done);
    } else {
        return await updateGitHubPullRequestStatus(status, done);
    }
}

/**
 * Create a Status Object to Send to GitHub
 * @param {object} eventData - Data from GitHub Event
 * @param {string} state - Current Task State (pending, passed, failed)
 * @param {string} context - Content Name to Display in GitHub
 * @param {string} description - Short Description to Display in GitHub
 * @param {string} url - Link to more detail
 *
 */
function createPullRequestStatus(eventData, state, context, description, url) {
    return {
        owner: eventData.repository.owner.login || 'Default_Owner',
        repo: eventData.repository.name || 'Default_Repository',
        sha: eventData.pull_request.head.sha || 'Missing SHA',
        number: eventData.pull_request.number,
        state: state,
        target_url: url ? url : 'https://github.com/zotoio/github-task-manager',
        description: description,
        context: context,
        eventData: eventData
    };
}

/**
 * export type ReposCreateStatusParams =
 & {
      owner: string;
      repo: string;
      sha: string;
      state: "pending"|"success"|"error"|"failure";
      target_url?: string;
      description?: string;
      context?: string;
    };
 */
async function updateGitHubPullRequestStatus(status, done) {
    console.log(`updating github for pull_request event ${status.eventData.ghEventId}`);
    //console.log(status);

    try {
        let github = connect(status.context);
        return await github.repos.createStatus(status).then(() => {
            done();
        });
    } catch (e) {
        if (e.message == 'OAuth2 authentication requires a token or key & secret to be set') {
            throw e;
        }
        console.log('----- ERROR COMMUNICATING WITH GITHUB -----');
        console.log(e);
        done();
    }
}

async function addGitHubPullRequestComment(status, done) {
    console.log(`add comment on pull_request completion ${status.eventData.ghEventId}`);
    /**
     * declare type PullRequestsCreateReviewParams =
     & {
      owner: string;
      repo: string;
      number: number;
      commit_id?: string;
      body?: string;
      event?: "APPROVE"|"REQUEST_CHANGES"|"COMMENT"|"PENDING";
      comments?: string[];
    };
     */
    try {
        let github = connect();
        return await github.pullRequests
            .createReview({
                owner: status.owner,
                repo: status.repo,
                number: parseInt(status.number),
                body: status.description,
                event: 'COMMENT'
            })
            .then(() => {
                done();
            });
    } catch (e) {
        console.log('----- ERROR COMMUNICATING WITH GITHUB -----');
        console.log(e);
        done();
    }
}

async function updateGitHubComment(status, done) {
    console.log(`updating github for comment event ${status.eventData.ghEventId}`);

    //let github = connect(status.context);
    //return await github.repos.createStatus(status).then(() => {
    done();
    //});
}

async function handleEventTaskResult(message, done) {
    let status = JSON.parse(message.Body);
    console.log(status);

    let updaterFunction = githubUpdaters[status.eventData.ghEventType];

    if (updaterFunction) {
        return updaterFunction(status, done);
    } else {
        console.error(`gitub updates for event type '${status.eventData.ghEventType}' are not supported yet.`);
        done();
    }
}

module.exports = {
    connect: connect,
    signRequestBody: signRequestBody,
    invalidHook: invalidHook,
    decodeFileResponse: decodeFileResponse,
    getFile: getFile,
    handleEventTaskResult: handleEventTaskResult,
    updateGitHubPullRequestStatus: updateGitHubPullRequestStatus,
    createPullRequestStatus: createPullRequestStatus
};
