import Link from "next/link";

export default function ChatThreadNotFound() {
  return (
    <main className="flex min-h-[calc(100vh-48px)] flex-col items-start gap-3 px-6 pt-12">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">
        404 · chat
      </span>
      <h1 className="m-0 text-[20px] font-semibold tracking-[-0.02em] text-fg">
        No chat thread with that id.
      </h1>
      <Link href="/chat" className="font-mono text-[12px] text-fg-mute hover:text-fg-body">
        ← All chats
      </Link>
    </main>
  );
}
