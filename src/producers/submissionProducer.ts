import { submissionQueue } from '../queues/submissionQueue';

export async function addSubmissionJob(payload: any) {
  await submissionQueue.add('submission', payload, {
    removeOnComplete: false, // Keep completed jobs visible in Bullboard
    removeOnFail: false,
  });
}
