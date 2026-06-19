import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface TagComboboxProps {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
}

const INPUT =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow";

export function TagCombobox({
  value,
  onChange,
  options,
  placeholder,
}: TagComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter(
    (o) => value === "" || o.toLowerCase().includes(value.toLowerCase()),
  );
  const showCreate =
    value.trim() !== "" && !options.some((o) => o === value.trim());

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <input
        className={INPUT}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg overflow-hidden">
          {filtered.length > 0 && (
            <ul className="max-h-48 overflow-y-auto py-1">
              {filtered.map((option) => (
                <li
                  key={option}
                  className={cn(
                    "px-3 py-2 text-sm cursor-pointer hover:bg-accent transition-colors",
                    option === value && "bg-accent font-medium",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(option);
                    setOpen(false);
                  }}
                >
                  {option}
                </li>
              ))}
            </ul>
          )}
          {showCreate && (
            <button
              type="button"
              className={cn(
                "px-3 py-2 text-sm cursor-pointer text-primary hover:bg-accent transition-colors flex items-center gap-1.5",
                filtered.length > 0 && "border-t",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(value.trim());
                setOpen(false);
              }}
            >
              <span>+</span>
              <span>{t("items.tagCreate", { value: value.trim() })}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
