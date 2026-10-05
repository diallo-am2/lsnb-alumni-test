export type OpportunityKind = "scholarship" | "internship" | "job" | "other";
export type OpportunityStatus = "published" | "closed" | "hidden";

export const opportunityKinds: { value: OpportunityKind; label: string; plural: string }[] = [
  { value: "scholarship", label: "Bourse", plural: "Bourses" },
  { value: "internship", label: "Stage", plural: "Stages" },
  { value: "job", label: "Emploi", plural: "Emplois" },
  { value: "other", label: "Autre", plural: "Autres" },
];

export function opportunityKindLabel(kind: OpportunityKind) {
  return opportunityKinds.find((item) => item.value === kind)?.label ?? "Offre";
}

export type OpportunityLink = { label: string; url: string };
export type OpportunityImage = { id: string; path: string; alt: string; url?: string };
export type OpportunityDocument = { id: string; path: string; name: string; url?: string };

export type Opportunity = {
  id: string;
  authorId: string;
  authorName: string;
  kind: OpportunityKind;
  title: string;
  organization: string;
  summary: string;
  description: string;
  country?: string;
  city?: string;
  isRemote: boolean;
  domain?: string;
  applyUrl?: string;
  extraLinks: OpportunityLink[];
  /** Local calendar date, YYYY-MM-DD. */
  deadline?: string;
  status: OpportunityStatus;
  createdAt: string;
  images: OpportunityImage[];
  document?: OpportunityDocument;
  isDemo?: boolean;
};

export function todayIso(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function isExpired(opportunity: Pick<Opportunity, "deadline">, today = todayIso()) {
  return Boolean(opportunity.deadline && opportunity.deadline < today);
}

export function formatDeadline(deadline: string) {
  return new Date(`${deadline}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function opportunityLocation(opportunity: Pick<Opportunity, "city" | "country" | "isRemote">) {
  const place = [opportunity.city, opportunity.country].filter(Boolean).join(", ");
  if (opportunity.isRemote) return place ? `${place} · à distance` : "À distance";
  return place || "Lieu non précisé";
}

const inSixMonths = () => {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return todayIso(date);
};

/** Fictional offers shown only when Supabase is not configured (demo mode). */
export const demoOpportunities: Opportunity[] = [
  {
    id: "demo-bourse-master",
    authorId: "demo",
    authorName: "Profil fictif",
    kind: "scholarship",
    title: "Bourse d’excellence pour un master en ingénierie",
    organization: "Fondation Exemple",
    summary: "Financement complet des frais d’études et d’un séjour de deux ans pour un master en Europe.",
    description:
      "## Pour qui ?\nÉlèves et alumni de filière scientifique, **moins de 26 ans**.\n\n## Ce qui est financé\n- Frais de scolarité\n- Allocation mensuelle\n- Billet aller-retour\n\nDossier à déposer sur [le site de la fondation](https://fondation.example.org/candidater).",
    country: "France",
    isRemote: false,
    domain: "Ingénierie",
    applyUrl: "https://fondation.example.org/candidater",
    extraLinks: [{ label: "Règlement de la bourse", url: "https://fondation.example.org/reglement" }],
    deadline: inSixMonths(),
    status: "published",
    createdAt: new Date().toISOString(),
    images: [],
    isDemo: true,
  },
  {
    id: "demo-stage-data",
    authorId: "demo",
    authorName: "Profil fictif",
    kind: "internship",
    title: "Stage de six mois en analyse de données",
    organization: "Atelier Données",
    summary: "Rejoignez une petite équipe pour construire des tableaux de bord utiles à des ONG partenaires.",
    description:
      "Missions : nettoyage de données, tableaux de bord, présentation aux partenaires.\n\nProfil : première année de cycle ingénieur ou équivalent, goût pour la rigueur.",
    country: "Maroc",
    city: "Rabat",
    isRemote: true,
    domain: "Informatique",
    extraLinks: [],
    status: "published",
    createdAt: new Date().toISOString(),
    images: [],
    isDemo: true,
  },
  {
    id: "demo-emploi-terrain",
    authorId: "demo",
    authorName: "Profil fictif",
    kind: "job",
    title: "Technicien·ne en énergie solaire",
    organization: "Soleil du Sahel",
    summary: "CDI à Bobo-Dioulasso : installation et maintenance de systèmes solaires pour des centres de santé.",
    description:
      "Poste basé à Bobo-Dioulasso avec déplacements réguliers.\n\n- Installation et maintenance\n- Formation des équipes locales\n- Rapports mensuels",
    country: "Burkina Faso",
    city: "Bobo-Dioulasso",
    isRemote: false,
    domain: "Énergie",
    applyUrl: "https://soleil.example.org/emplois",
    extraLinks: [],
    status: "published",
    createdAt: new Date().toISOString(),
    images: [],
    isDemo: true,
  },
];
