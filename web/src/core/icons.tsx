interface IProps {
  size?: number;
}
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconSearch = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const IconMail = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
export const IconPhone = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l1 4v3a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
  </svg>
);
export const IconGlobe = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
);
export const IconInstagram = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </svg>
);
export const IconLinkedin = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7" />
  </svg>
);
export const IconWhatsapp = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1 1 21 11.5z" />
    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5.5 0 1-.5 1-1s-1.5-1-2-1-1 1-1.5.5-1-1-1-1.5.5-1 .5-1-.5-2-1-2-1 .5-1 1z" />
  </svg>
);
export const IconLink = ({ size = 16 }: IProps) => (
  <svg {...base(size)}>
    <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1" />
    <path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />
  </svg>
);
