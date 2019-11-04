/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

export default class KeyVerificationStateObserver {
    constructor(requestEvent, client, updateCallback) {
        this._requestEvent = requestEvent;
        this._client = client;
        this._updateCallback = updateCallback;
        this.accepted = false;
        this.done = false;
        this.cancelled = false;
        this._updateVerificationState();
    }

    attach() {
        this._requestEvent.on("Event.relationsCreated", this._onRelationsCreated);
    }

    detach() {
        const roomId = this._requestEvent.getRoomId();
        const room = this._client.getRoom(roomId);

        for (const phaseName of ["start", "cancel", "done"]) {
            const relations = room.getUnfilteredTimelineSet()
                .getRelationsForEvent(this._requestEvent.getId(), "m.reference", `m.key.verification.${phaseName}`);
            if (relations) {
                relations.removeListener("Relations.add", this._onRelationsUpdated);
                relations.removeListener("Relations.remove", this._onRelationsUpdated);
                relations.removeListener("Relations.redaction", this._onRelationsUpdated);
            }
        }
        this._requestEvent.removeListener("Event.relationsCreated", this._onRelationsCreated);
    }


    _onRelationsCreated = (relationType, eventType) => {
        if (relationType !== "m.reference") {
            return;
        }
        if (
            eventType !== "m.key.verification.start" &&
            eventType !== "m.key.verification.cancel" &&
            eventType !== "m.key.verification.done"
        ) {
            return;
        }

        const roomId = this._requestEvent.getRoomId();
        const room = this._client.getRoom(roomId);
        const relations = room.getUnfilteredTimelineSet()
            .getRelationsForEvent(this._requestEvent.getId(), relationType, eventType);

        relations.on("Relations.add", this._onRelationsUpdated);
        relations.on("Relations.remove", this._onRelationsUpdated);
        relations.on("Relations.redaction", this._onRelationsUpdated);

        this._updateVerificationState();
        this._updateCallback();
    };

    _onRelationsUpdated = (event) => {
        this._updateVerificationState();
        this._updateCallback();
    };

    _updateVerificationState() {
        const roomId = this._requestEvent.getRoomId();
        const room = this._client.getRoom(roomId);
        const timelineSet = room.getUnfilteredTimelineSet();
        const fromUserId = this._requestEvent.getSender();
        const content = this._requestEvent.getContent();
        const toUserId = content.to;

        this.cancelled = false;
        this.done = false;
        this.accepted = false;
        this.otherPartyUserId = null;
        this.cancelPartyUserId = null;

        const startRelations = timelineSet.getRelationsForEvent(
            this._requestEvent.getId(), "m.reference", "m.key.verification.start");
        if (startRelations) {
            for (const startEvent of startRelations.getRelations()) {
                if (startEvent.getSender() === toUserId) {
                    this.accepted = true;
                }
            }
        }

        const doneRelations = timelineSet.getRelationsForEvent(
            this._requestEvent.getId(), "m.reference", "m.key.verification.done");
        if (doneRelations) {
            let senderDone = false;
            let receiverDone = false;
            for (const doneEvent of doneRelations.getRelations()) {
                if (doneEvent.getSender() === toUserId) {
                    receiverDone = true;
                } else if (doneEvent.getSender() === fromUserId) {
                    senderDone = true;
                }
            }
            console.log("doneRelations", senderDone, receiverDone);
            if (senderDone && receiverDone) {
                this.done = true;
            }
        }

        if (!this.done) {
            const cancelRelations = timelineSet.getRelationsForEvent(
                this._requestEvent.getId(), "m.reference", "m.key.verification.cancel");

            if (cancelRelations) {
                let earliestCancelEvent;
                for (const cancelEvent of cancelRelations.getRelations()) {
                    // only accept cancellation from the users involved
                    if (cancelEvent.getSender() === toUserId || cancelEvent.getSender() === fromUserId) {
                        this.cancelled = true;

                        if (!earliestCancelEvent || cancelEvent.getTs() < earliestCancelEvent.getTs()) {
                            earliestCancelEvent = cancelEvent;
                        }
                    }
                }
                if (earliestCancelEvent) {
                    this.cancelPartyUserId = earliestCancelEvent.getSender();
                }
            }
        }

        this.otherPartyUserId = fromUserId === this._client.getUserId() ? toUserId : fromUserId;
    }
}
