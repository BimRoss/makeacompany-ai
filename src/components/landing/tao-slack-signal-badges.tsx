import Image from "next/image";

export function TaoSlackSignalBadges() {
  return (
    <div className="tao-slack-signal-wrap" aria-label="Bittensor and Slack signal badges">
      <div className="tao-slack-signal-stack">
        <div className="tao-slack-signal-button tao-slack-signal-button--slack">
          <Image
            src="/tao-slack/slack-pilled.png"
            alt="Slack"
            width={1024}
            height={1024}
            className="tao-slack-signal-image"
            priority={false}
          />
        </div>
        <div className="tao-slack-signal-button tao-slack-signal-button--tao">
          <Image
            src="/tao-slack/tao-pilled.png"
            alt="Bittensor TAO"
            width={1024}
            height={1024}
            className="tao-slack-signal-image"
            priority={false}
          />
        </div>
      </div>
    </div>
  );
}
