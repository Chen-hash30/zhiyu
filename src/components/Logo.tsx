import iconUrl from '../assets/app-icon.png';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="logo-image"
    />
  );
}