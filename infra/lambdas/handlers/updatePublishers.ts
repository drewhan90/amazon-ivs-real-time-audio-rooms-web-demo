import { ParticipantState } from '@aws-sdk/client-ivs-realtime';
import { ddbSdk, realTimeSdk } from '@Lambda/sdk';
import { StageUpdateEventDetail } from '@Lambda/types';
import { createRoomIdFromStageArn } from '@Lambda/utils';
import { EventBridgeEvent } from 'aws-lambda';

async function handler(
  event: EventBridgeEvent<'IVS Stage Update', StageUpdateEventDetail>
) {
  const {
    event_name: eventName,
    participant_id: participantId,
    session_id: activeSessionId
  } = event.detail;
  const stageArn = event.resources[0];
  const roomId = createRoomIdFromStageArn(stageArn);
  const isPublishing = eventName === 'Participant Published';

  try {
    let state: ParticipantState;

    if (isPublishing) {
      // Participant published, so they must be CONNECTED
      state = ParticipantState.CONNECTED;
    } else {
      /**
       * Participant unpublished, but their state is unknown. To ensure data consistency,
       * we will call getParticipant to update the state so we don't have to wait for the
       * next subscriber update to do so.
       */
      const participant = await realTimeSdk.getParticipant(
        stageArn,
        participantId,
        activeSessionId
      );

      state = participant.state as ParticipantState;
    }

    const { publishers } = await ddbSdk.updateRoomParticipant({
      id: roomId,
      participant: { participantId, state },
      isPublishing
    });

    if (publishers?.size) {
      // If there are still publishers left, then the room must be active -> set the activeSessionId
      await ddbSdk.updateRoomRecord({
        id: roomId,
        attrsToSet: { activeSessionId }
      });
    } else {
      // If there are no publishers left, then the room must be inactive -> remove the activeSessionId, subscribers and publishers
      await ddbSdk.updateRoomRecord({
        id: roomId,
        attrsToRemove: ['activeSessionId', 'subscribers', 'publishers']
      });
    }
  } catch (error) {
    console.error(error);
  }
}

export { handler };
