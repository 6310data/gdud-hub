import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4 text-center">
      <h1 className="tz-title">הדף לא נמצא</h1>
      <p className="tz-body m-0 text-ink-muted">ייתכן שאין לך הרשאה לדף הזה, או שהוא לא קיים.</p>
      <Link href="/" className="tz-btn tz-btn-tinted">
        חזרה לדף הבית
      </Link>
    </main>
  );
}
