import { Link } from "react-router-dom";
import { ROUTES } from "../config/routes";

interface RoutePlaceholderProps {
  title: string;
  description: string;
  showHomeLink?: boolean;
}

export function RoutePlaceholder({
  title,
  description,
  showHomeLink = false,
}: RoutePlaceholderProps) {
  return (
    <main className="rm-page">
      <h1>{title}</h1>
      <p>{description}</p>
      {showHomeLink && <Link to={ROUTES.root}>Go home</Link>}
    </main>
  );
}
