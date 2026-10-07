import { Inbox, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useRequestBadge } from "../../hooks/useRequestBadge";
import { cn } from "../../lib/cn";
import { BrandMark } from "../ui/BrandMark";
import { ButtonLink } from "../ui/Button";

const navigation = [
  { label: "Annuaire", to: "/annuaire" },
  { label: "Offres", to: "/offres" },
  { label: "Highlight", to: "/#highlights" },
  { label: "Mentorat", to: "/#mentorat" },
  { label: "Le réseau", to: "/#reseau" },
];

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { user, isLoading } = useAuth();
  const pendingRequests = useRequestBadge();
  const requestsLabel = pendingRequests > 0
    ? `Demandes, ${pendingRequests} nécessitant votre attention`
    : "Demandes";

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <header className="site-header">
      <div className="site-header__inner page-shell">
        <BrandMark />

        <nav className="site-header__desktop-nav" aria-label="Navigation principale">
          {navigation.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn("site-header__link", isActive && item.to === location.pathname && "is-active")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="site-header__actions">
          {!isLoading && user ? (
            <>
              <NavLink to="/espace/demandes" className="site-header__requests" aria-label={requestsLabel}>
                <Inbox size={20} aria-hidden="true" />
                {pendingRequests > 0 && (
                  <span className="site-header__badge" aria-hidden="true">{pendingRequests > 9 ? "9+" : pendingRequests}</span>
                )}
              </NavLink>
              <ButtonLink to="/espace" size="sm" variant="light">
                Mon espace
              </ButtonLink>
            </>
          ) : !isLoading ? (
            <>
              <NavLink to="/connexion" className="site-header__login">
                Se connecter
              </NavLink>
              <ButtonLink to="/rejoindre" size="sm" variant="light">
                Rejoindre le réseau
              </ButtonLink>
            </>
          ) : null}
        </div>

        <button
          type="button"
          className="site-header__menu-button"
          aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {menuOpen && (
        <div id="mobile-navigation" className="site-header__mobile-panel is-open">
          <nav aria-label="Navigation mobile" className="page-shell">
            {navigation.map((item) => (
              <NavLink key={item.label} to={item.to}>
                {item.label}
              </NavLink>
            ))}
            {user ? (
              <>
                <NavLink to="/espace/demandes">
                  Demandes{pendingRequests > 0 ? ` (${pendingRequests})` : ""}
                </NavLink>
                <ButtonLink to="/espace" variant="light" className="mt-2">
                  Mon espace
                </ButtonLink>
              </>
            ) : (
              <>
                <NavLink to="/connexion">Se connecter</NavLink>
                <ButtonLink to="/rejoindre" variant="light" className="mt-2">
                  Rejoindre le réseau
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
