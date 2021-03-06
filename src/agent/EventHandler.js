'use strict';
import requireDir from 'require-dir';
import { Plugin } from './Plugin';
import { default as json } from 'format-json';

export class EventHandler extends Plugin {
    constructor(eventData, log) {
        super();
        this.log = log;

        log.debug(`incoming event: ${json.plain(eventData)}`);

        this.eventId = eventData.ghEventId;
        this.eventType = eventData.ghEventType;
        this.taskConfig = eventData.ghTaskConfig;
        this.eventData = eventData;
        this.MessageHandle = eventData.MessageHandle;

        // Handle Older Task Format
        try {
            this.tasks = this.taskConfig[this.eventType].tasks;
        } catch (error) {
            log.error('No Tasks Defined for Event Type ' + this.eventType);
            log.debug(error);
            this.tasks = {};
        }

        log.info('----------------------------');
        log.info('New Event Received');
        log.info('Event ID: ' + this.eventId);
        log.info('Event Type: ' + this.eventType);
        log.info('Tasks: ' + json.plain(this.tasks));
        log.debug(eventData);
    }
}

requireDir('../handlers');
