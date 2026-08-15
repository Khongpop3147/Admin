// Sales-channel icons, shared between OrderEntryForm and any other form that
// needs the same "ช่องทางการขาย" picker (e.g. app/pending-stock/page.tsx) so
// the two never visually drift apart.

export function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M16.5 12.5h-2.2v7h-3v-7H9.7v-2.6h1.6V8.3c0-1.5.9-2.9 3.2-2.9.9 0 1.6.08 1.8.11v2.3h-1.3c-.7 0-.8.34-.8.83v1.86h2.4l-.1 2.6z" />
    </svg>
  );
}

export function LineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#06C755" />
      <path fill="#fff" d="M19 11.2c0-3.1-3.1-5.7-7-5.7s-7 2.6-7 5.7c0 2.8 2.5 5.1 5.8 5.6.23.05.53.15.6.34.07.17.05.44.02.61l-.1.6c-.03.17-.13.66.58.36s3.8-2.24 5.2-3.83c.95-1.05 1.9-2.1 1.9-3.68z" />
    </svg>
  );
}

export function TikTokIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#000" />
      <path fill="#fff" d="M15.5 5.5c.4 1.8 1.6 3 3.5 3.2v2.4c-1.2 0-2.3-.4-3.2-1v5.1c0 2.6-2.1 4.8-4.8 4.8-2.6 0-4.8-2.1-4.8-4.8 0-2.6 2.1-4.8 4.8-4.8.3 0 .5 0 .8.07v2.5c-.25-.1-.5-.15-.8-.15-1.3 0-2.3 1-2.3 2.3s1 2.3 2.3 2.3 2.4-1 2.4-2.3V5.5h2.1z" />
    </svg>
  );
}

export function ShopeeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#EE4D2D" />
      <path fill="#fff" d="M9.5 9V7.5a2.5 2.5 0 015 0V9h1.5l.8 9.4a1.5 1.5 0 01-1.5 1.6H8.7a1.5 1.5 0 01-1.5-1.6L8 9h1.5zm1.5 0h2V7.5a1 1 0 00-2 0V9z" />
    </svg>
  );
}

export function OtherPlatformIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="6" fill="#6b7280" />
      <circle cx="7" cy="12" r="1.5" fill="#fff" />
      <circle cx="12" cy="12" r="1.5" fill="#fff" />
      <circle cx="17" cy="12" r="1.5" fill="#fff" />
    </svg>
  );
}

export const PLATFORM_OPTIONS = [
  { value: "Facebook", label: "Facebook", icon: <FacebookIcon /> },
  { value: "Line", label: "Line", icon: <LineIcon /> },
  { value: "TikTok", label: "TikTok", icon: <TikTokIcon /> },
  { value: "Shopee", label: "Shopee", icon: <ShopeeIcon /> },
  { value: "Other", label: "อื่นๆ", icon: <OtherPlatformIcon /> },
];
