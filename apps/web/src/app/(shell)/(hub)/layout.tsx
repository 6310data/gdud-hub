import Link from "next/link";
import { Avatar, Icon } from "@gdud/ui";
import { displayName, requireSession } from "@/lib/session";

/** The hub: pick a module on the home page; every module then opens as its own app. */
export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const { user, claims } = await requireSession();
  const name = displayName(user, claims);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-[#0f1b2d14] bg-[var(--chrome)] backdrop-blur-xl print:hidden">
        <div className="mx-auto flex min-h-14 w-full max-w-[960px] items-center gap-3 px-4 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5 text-ink no-underline">
            <span className="tz-app-mark" aria-hidden="true">
              ג
            </span>
            <span className="tz-headline">מערכת הגדוד</span>
          </Link>
          <span className="flex-1" />
          <span className="hidden min-w-0 items-center gap-2.5 sm:flex">
            <Avatar name={name} size={32} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[14px] font-semibold">{name}</span>
              <span className="tz-app-sub truncate text-end" dir="ltr">
                {user.email}
              </span>
            </span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="tz-icon-btn" aria-label="יציאה" title="יציאה">
              <Icon name="logout" size={20} />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[960px] px-4 pb-16 pt-6 lg:px-8">{children}</main>
    </div>
  );
}
