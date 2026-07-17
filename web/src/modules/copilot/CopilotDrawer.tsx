import ChatDrawer from "@/modules/chat/ChatDrawer";
import { COPILOT_SUGGESTIONS } from "@/core/copilot";
import { IconCopilot } from "@/core/icons";

interface Props {
  onClose: () => void;
}

// Owner-only Copilot. A thin configuration of the shared ChatDrawer.
export default function CopilotDrawer({ onClose }: Props) {
  return (
    <ChatDrawer
      title="Copilot"
      icon={<IconCopilot size={16} />}
      endpoint="copilot"
      ns="copilot"
      placeholder="Ask the copilot…"
      closeTitle="Close (⌘J)"
      onClose={onClose}
      renderEmpty={(send) => <CopilotEmpty onPick={send} />}
    />
  );
}

function CopilotEmpty({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="cp-empty">
      <div className="cp-empty-mark">
        <IconCopilot size={22} />
      </div>
      <div className="cp-empty-title">Ask about your workspace</div>
      <div className="cp-empty-sub">
        A calm operations assistant with the whole graph in view — people,
        organizations, and mail activity.
      </div>
      <div className="cp-chips">
        {COPILOT_SUGGESTIONS.map((q) => (
          <button key={q} className="cp-chip" onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
