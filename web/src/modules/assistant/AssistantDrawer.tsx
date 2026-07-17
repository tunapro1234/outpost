import ChatDrawer from "@/modules/chat/ChatDrawer";
import { IconAssistant } from "@/core/icons";

interface Props {
  seed?: string | null;
  onSeedConsumed?: () => void;
  onReplyComplete?: (threadId?: string) => void;
  onClose: () => void;
}

// Personal Assistant — available to every user. A thin configuration of the
// shared ChatDrawer. It can answer from the vault and rearrange the caller's
// dashboard, so replies signal a dashboard refetch via onReplyComplete.
export default function AssistantDrawer({
  seed,
  onSeedConsumed,
  onReplyComplete,
  onClose,
}: Props) {
  return (
    <ChatDrawer
      title="Assistant"
      icon={<IconAssistant size={16} />}
      endpoint="assistant"
      ns="assistant"
      placeholder="Ask your assistant…"
      closeTitle="Close (Esc)"
      seed={seed}
      onSeedConsumed={onSeedConsumed}
      onReplyComplete={onReplyComplete}
      onClose={onClose}
      renderEmpty={() => (
        <div className="cp-empty">
          <div className="cp-empty-mark">
            <IconAssistant size={22} />
          </div>
          <div className="cp-empty-title">Assistant</div>
          <div className="cp-empty-sub">
            Your personal assistant — it can answer from the vault and rearrange
            this dashboard for you.
          </div>
        </div>
      )}
    />
  );
}
