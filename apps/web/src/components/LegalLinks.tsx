import { Link } from "react-router-dom";

interface LegalLinksProps {
  className?: string;
}

export function LegalLinks({ className = "legal-links" }: LegalLinksProps) {
  return (
    <nav className={className} aria-label="Rechtliche Informationen">
      <Link to="/imprint">Impressum</Link>
      <Link to="/privacy">Datenschutz</Link>
      <Link to="/terms">Nutzungsbedingungen</Link>
    </nav>
  );
}
