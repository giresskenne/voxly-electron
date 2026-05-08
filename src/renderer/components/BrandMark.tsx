import logo from "../assets/voxly-logo.png";
import { brand } from "../design/source";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark">
      <img src={logo} alt="" className="brand-mark__logo" />
      {!compact && (
        <div>
          <div className="brand-mark__name">{brand.name}</div>
          <div className="brand-mark__tagline">{brand.tagline}</div>
        </div>
      )}
    </div>
  );
}
