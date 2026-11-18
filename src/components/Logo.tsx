import { Link } from 'react-router-dom';

interface LogoProps {
  to?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function Logo({ to = '/', size = 'md' }: LogoProps) {
  const sizeClass =
    size === 'sm'
      ? 'text-lg'
      : size === 'lg'
        ? 'text-2xl'
        : 'text-xl';

  return (
    <Link
      to={to}
      className={`font-display font-extrabold tracking-tight whitespace-nowrap shrink-0 inline-flex items-baseline ${sizeClass}`}
      aria-label="BookAm home"
    >
      <span className="text-[#635BFF]">Book</span>
      <span className="text-[#FF6B35]">Am</span>
    </Link>
  );
}
