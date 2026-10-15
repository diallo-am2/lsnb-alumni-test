import { ArrowUpRight, ExternalLink, Globe, Linkedin, MapPin, Orbit } from "lucide-react";
import { Link } from "react-router-dom";
import type { AlumniProfile } from "../../data/alumni";
import { cn } from "../../lib/cn";
import { toSafeProfileUrl } from "../../lib/profileLinks";
import { Avatar } from "../ui/Avatar";
import { AlumniCardMotion } from "./AlumniCardMotion";

type AlumniCardProps = {
  profile: AlumniProfile;
  featured?: boolean;
};

export function AlumniCard({ profile, featured = false }: AlumniCardProps) {
  const linkedinUrl = toSafeProfileUrl(profile.linkedinUrl);
  const portfolioUrl = toSafeProfileUrl(profile.portfolioUrl);

  return (
    <article className={cn(
      "alumni-card",
      featured && "alumni-card--featured",
      profile.photoUrl && "alumni-card--with-photo",
    )}>
      <AlumniCardMotion profileId={profile.id} />

      <div className="alumni-card__topline">
        <Avatar
          initials={profile.initials}
          avatarTone={profile.avatarTone}
          photoUrl={profile.photoUrl}
          className="alumni-card__avatar"
          label={`${profile.isDemo === false ? "Photo" : "Portrait fictif"} de ${profile.firstName} ${profile.lastName}`}
        />
        <span className="alumni-card__promotion">Promo {profile.graduationYear}</span>
      </div>

      <div className="alumni-card__body">
        <p className="alumni-card__domain">{profile.domain}</p>
        <h3>{profile.firstName} {profile.lastName}</h3>
        <p className="alumni-card__role">{profile.currentRole}</p>
        <p className="alumni-card__location">
          <MapPin size={15} aria-hidden="true" />
          {profile.city}, {profile.country}
        </p>
      </div>

      <div className="alumni-card__footer">
        {profile.offersMentoring ? (
          <span className="alumni-card__mentor">
            <Orbit size={15} aria-hidden="true" /> Mentorat proposé
          </span>
        ) : (
          <span className="alumni-card__specialty">{profile.specialties[0]}</span>
        )}
        <div className="alumni-card__links">
          {linkedinUrl && (
            <a className="alumni-card__social-link" href={linkedinUrl} target="_blank" rel="noopener noreferrer"
              aria-label={`LinkedIn de ${profile.firstName} (s’ouvre dans un nouvel onglet)`}>
              <Linkedin size={16} aria-hidden="true" />
            </a>
          )}
          {portfolioUrl && (
            <a className="alumni-card__social-link" href={portfolioUrl} target="_blank" rel="noopener noreferrer"
              aria-label={`Portfolio de ${profile.firstName} (s’ouvre dans un nouvel onglet)`}>
              <Globe size={16} aria-hidden="true" />
            </a>
          )}
          <Link to={`/alumni/${profile.id}`} aria-label={`Voir le profil de ${profile.firstName} ${profile.lastName}`}>
            Voir le profil <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
