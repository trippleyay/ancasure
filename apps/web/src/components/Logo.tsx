export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <img
      src="/logo.svg"
      alt="AncaSure logo"
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
    />
  );
}