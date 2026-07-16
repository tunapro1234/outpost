type Props = {
  message: string | null;
};

export default function ControlToast({ message }: Props) {
  if (!message) return null;
  return (
    <div className="control-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
