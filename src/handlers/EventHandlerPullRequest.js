import { EventHandler } from '../agent/EventHandler';
import { Executor } from '../agent/Executor';
import { AgentUtils } from '../agent/AgentUtils';
let log = AgentUtils.logger();

export class EventHandlerPullRequest extends EventHandler {
    async handleEvent() {
        let supportedActions = ['opened', 'synchronize'];

        if (!supportedActions.includes(this.eventData.action)) {
            log.error(`Unsupported Action: '${this.eventData.action}'`);
            return;
        }

        log.info('---------------------------------');
        log.info('Repository Name: ' + this.eventData.repository.name);
        log.info('Pull Request: ' + this.eventData.pull_request.number);
        log.info('---------------------------------');

        this.tasks = AgentUtils.templateReplace(AgentUtils.createBasicTemplate(this.eventData), this.tasks);

        return this.handleTasks(this);
    }

    async handleTasks(event) {
        return this.setIntialTaskState(event).then(() => {
            return this.processTasks(event);
        })
    }

    async setIntialTaskState(event) {
        let promises = [];

        event.tasks.forEach(async task => {
            let initialState = 'pending';
            let initialDesc = 'Task Execution in Progress';
            if (!Executor.isRegistered(task.executor)) {
                initialState = 'error';
                initialDesc = 'Unknown Executor: ' + task.executor;
            }

            let status = AgentUtils.createPullRequestStatus(
                event.eventData,
                initialState,
                `${task.executor}: ${task.context}`,
                initialDesc,
                'https://github.com' // fails if not an https url
            );

            promises.push(
                AgentUtils.postResultsAndTrigger(
                    process.env.GTM_SQS_RESULTS_QUEUE,
                    status,
                    process.env.GTM_SNS_RESULTS_TOPIC,
                    `Pending for ${event.eventType} => ${task.executor}:${task.context} - Event ID: ${event.eventId}`
                ).then(function() {
                    log.info(task);
                    log.info('-----------------------------');
                })
            );
        });

        return Promise.all(promises);
    }

    async processTasks(event) {
        let promises = [];

        event.tasks.forEach(async task => {

            if (!Executor.isRegistered(task.executor)) {
                return;
            }

            // Check for Sub-Tasks and Wait for Completion
            if (task.tasks) {
                log.info(`Task ${task.executor}:${task.context} has Sub-Tasks. Waiting for Completion before Continuing.`);
                await this.handleTasks(task).then(() => {
                    log.info(`Sub-Tasks for ${task.executor}:${task.context} Completed.`)
                });
            }

            log.info('=================================');
            log.info('Creating Executor for Task: ' + task.executor + ':' + task.context);
            let executor = Executor.create(task.executor, event.eventData);

            let status;
            let taskPromise;

            try {
                taskPromise = executor
                    .executeTask(task)
                    .then(taskResult => {
                        if (taskResult === 'NO_MATCHING_TASK') {
                            status = AgentUtils.createPullRequestStatus(
                                event.eventData,
                                'error',
                                `${task.executor}: ${task.context}`,
                                'Unknown Task Type: ' + task.context,
                                'https://kuro.neko.ac'
                            );
                        } else {
                            let defaultResultMessage = taskResult.passed
                                ? 'Task Completed Successfully'
                                : 'Task Completed with Errors';
                            let taskResultMessage = taskResult.message || defaultResultMessage;
                            status = AgentUtils.createPullRequestStatus(
                                event.eventData,
                                taskResult.passed ? 'success' : 'error',
                                `${task.executor}: ${task.context}`,
                                taskResultMessage,
                                taskResult.url
                            );
                        }
                        return status;
                    })
                    .then(status => {
                        return AgentUtils.postResultsAndTrigger(
                            process.env.GTM_SQS_RESULTS_QUEUE,
                            status,
                            process.env.GTM_SNS_RESULTS_TOPIC,
                            `Result '${status.state}' for ${event.eventType} => ${task.executor}:${
                                task.context
                            } - Event ID: ${event.eventId}`
                        );
                    })
                    .catch(e => {
                        log.error(e);
                        status = AgentUtils.createPullRequestStatus(
                            event.eventData,
                            'error',
                            `${task.executor}: ${task.context}`,
                            'Task execution failure'
                        );

                        return AgentUtils.postResultsAndTrigger(
                            process.env.GTM_SQS_RESULTS_QUEUE,
                            status,
                            process.env.GTM_SNS_RESULTS_TOPIC,
                            `Result 'error' for ${event.eventType} => ${task.executor}:${task.context} - Event ID: ${
                                event.eventId
                            }`
                        );
                    });
            } catch (e) {
                log.error(e);
                taskPromise = Promise.reject(e.message);
            }

            promises.push(taskPromise);
        });

        return Promise.all(promises);
    }
}

EventHandler.register('pull_request', EventHandlerPullRequest);
