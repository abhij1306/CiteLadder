import { GCP_PULL_SETUP } from '@/lib/config/crawl-logs';

/** A single quote inside a single-quoted POSIX shell string: close, escaped quote, reopen. */
const QUOTE = String.raw`'\''`;
/** A value inside single quotes for a POSIX shell. */
const quoted = (value: string) => "'" + value.replaceAll("'", QUOTE) + "'";

/**
 * The `gcloud` commands that route crawler request logs into the source's
 * subscription and let CiteLadder's reader pull it. Project and subscription
 * come from the subscription path the customer entered.
 */
export function gcpSetupCommands(input: {
  subscription: string;
  nonce: string;
  readerEmail: string;
  logFilter: string;
  sampleRate: number;
}) {
  const [, project = 'PROJECT', , subscription = 'SUBSCRIPTION'] = input.subscription.split('/');
  const { topic, sink, ackDeadlineSeconds, retention, sourceLabel } = GCP_PULL_SETUP;
  const p = `--project=${project}`;
  const reader = `serviceAccount:${input.readerEmail}`;
  return [
    `gcloud pubsub topics create ${topic} ${p}`,
    `gcloud pubsub subscriptions create ${subscription} ${p} --topic=${topic} --ack-deadline=${ackDeadlineSeconds} --message-retention-duration=${retention} --labels=${sourceLabel}=${input.nonce}`,
    `gcloud logging sinks create ${sink} pubsub.googleapis.com/projects/${project}/topics/${topic} ${p} --log-filter=${quoted(input.logFilter)}`,
    `gcloud pubsub topics add-iam-policy-binding ${topic} ${p} --member="$(gcloud logging sinks describe ${sink} ${p} --format='value(writerIdentity)')" --role=roles/pubsub.publisher`,
    `gcloud pubsub subscriptions add-iam-policy-binding ${subscription} ${p} --member=${reader} --role=roles/pubsub.subscriber`,
    `gcloud pubsub subscriptions add-iam-policy-binding ${subscription} ${p} --member=${reader} --role=roles/pubsub.viewer`,
    '# For a regional load balancer, replace --global with --region=REGION.',
    `gcloud compute backend-services update BACKEND_SERVICE --global ${p} --enable-logging --logging-sample-rate=${Number.isInteger(input.sampleRate) ? input.sampleRate.toFixed(1) : input.sampleRate}`,
  ].join('\n');
}
