"use client";
import { useRef, useState } from "react";
import { Button, Icon, Spinner } from "@gdud/ui";

const XLSX_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * Choose a file: a drop zone with a "בחירת קובץ" button, then the chosen file with "החלפה".
 * The caller checks the file (type, size) and keeps it in state.
 */
export function FilePicker({
  file,
  onFile,
  accept = XLSX_ACCEPT,
  hint,
  busy,
  busyLabel = "קורא את הקובץ…",
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept?: string;
  hint?: string;
  /** the file is being read (e.g. the first request after choosing it) */
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const choose = () => input.current?.click();

  const hidden = (
    <input
      ref={input}
      type="file"
      accept={accept}
      className="sr-only"
      tabIndex={-1}
      aria-label="קובץ"
      disabled={disabled}
      onChange={(e) => {
        onFile(e.target.files?.[0] ?? null);
        e.target.value = ""; // choosing the same file again fires onChange again
      }}
    />
  );

  if (file) {
    return (
      <div className="tz-file">
        {hidden}
        <span className="tz-tile" style={{ background: "var(--tile-ok)" }}>
          <Icon name="table" size={17} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold" dir="auto">
            {file.name}
          </span>
          <span className="tz-footnote flex items-center gap-1.5">
            {busy ? (
              <>
                <Spinner size={12} />
                {busyLabel}
              </>
            ) : (
              <span className="tz-num">{fileSize(file.size)}</span>
            )}
          </span>
        </span>
        <Button type="button" variant="plain" small onClick={choose} disabled={disabled || busy}>
          החלפה
        </Button>
      </div>
    );
  }

  return (
    <div
      className="tz-drop"
      data-over={over || undefined}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null);
      }}
    >
      {hidden}
      <span className="tz-drop-icon" aria-hidden="true">
        {busy ? <Spinner size={22} /> : <Icon name="upload" size={24} />}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="tz-headline">{busy ? busyLabel : "גררו לכאן את קובץ ה-Excel"}</span>
        {hint ? <span className="tz-footnote">{hint}</span> : null}
      </span>
      <Button type="button" small onClick={choose} disabled={disabled} loading={busy}>
        {busy ? null : <Icon name="upload" size={16} />}
        בחירת קובץ
      </Button>
    </div>
  );
}
