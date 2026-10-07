/** Canonical (French) country names: one spelling per country keeps the "Pays" filter clean. */
export const COUNTRIES: readonly string[] = [
  "Afghanistan", "Afrique du Sud", "Albanie", "Algérie", "Allemagne", "Andorre", "Angola", "Antigua-et-Barbuda",
  "Arabie saoudite", "Argentine", "Arménie", "Australie", "Autriche", "Azerbaïdjan", "Bahamas", "Bahreïn",
  "Bangladesh", "Barbade", "Belgique", "Belize", "Bénin", "Bhoutan", "Biélorussie", "Birmanie", "Bolivie",
  "Bosnie-Herzégovine", "Botswana", "Brésil", "Brunei", "Bulgarie", "Burkina Faso", "Burundi", "Cambodge",
  "Cameroun", "Canada", "Cap-Vert", "Centrafrique", "Chili", "Chine", "Chypre", "Colombie", "Comores", "Congo",
  "Corée du Nord", "Corée du Sud", "Costa Rica", "Côte d’Ivoire", "Croatie", "Cuba", "Danemark", "Djibouti",
  "Dominique", "Égypte", "Émirats arabes unis", "Équateur", "Érythrée", "Espagne", "Estonie", "Eswatini",
  "États-Unis", "Éthiopie", "Fidji", "Finlande", "France", "Gabon", "Gambie", "Géorgie", "Ghana", "Grèce",
  "Grenade", "Guatemala", "Guinée", "Guinée équatoriale", "Guinée-Bissau", "Guyana", "Haïti", "Honduras",
  "Hongrie", "Îles Salomon", "Inde", "Indonésie", "Irak", "Iran", "Irlande", "Islande", "Israël", "Italie",
  "Jamaïque", "Japon", "Jordanie", "Kazakhstan", "Kenya", "Kirghizistan", "Kiribati", "Kosovo", "Koweït", "Laos",
  "Lesotho", "Lettonie", "Liban", "Libéria", "Libye", "Liechtenstein", "Lituanie", "Luxembourg",
  "Macédoine du Nord", "Madagascar", "Malaisie", "Malawi", "Maldives", "Mali", "Malte", "Maroc", "Maurice",
  "Mauritanie", "Mexique", "Micronésie", "Moldavie", "Monaco", "Mongolie", "Monténégro", "Mozambique", "Namibie",
  "Nauru", "Népal", "Nicaragua", "Niger", "Nigéria", "Norvège", "Nouvelle-Zélande", "Oman", "Ouganda",
  "Ouzbékistan", "Pakistan", "Palaos", "Palestine", "Panama", "Papouasie-Nouvelle-Guinée", "Paraguay",
  "Pays-Bas", "Pérou", "Philippines", "Pologne", "Portugal", "Qatar", "République démocratique du Congo",
  "République dominicaine", "Roumanie", "Royaume-Uni", "Russie", "Rwanda", "Saint-Christophe-et-Niévès",
  "Saint-Marin", "Saint-Vincent-et-les-Grenadines", "Sainte-Lucie", "Salvador", "Samoa", "Sao Tomé-et-Principe",
  "Sénégal", "Serbie", "Seychelles", "Sierra Leone", "Singapour", "Slovaquie", "Slovénie", "Somalie", "Soudan",
  "Soudan du Sud", "Sri Lanka", "Suède", "Suisse", "Suriname", "Syrie", "Tadjikistan", "Taïwan", "Tanzanie",
  "Tchad", "Tchéquie", "Thaïlande", "Timor oriental", "Togo", "Tonga", "Trinité-et-Tobago", "Tunisie",
  "Turkménistan", "Turquie", "Tuvalu", "Ukraine", "Uruguay", "Vanuatu", "Venezuela", "Vietnam", "Yémen",
  "Zambie", "Zimbabwe",
];

/** Spelling variants members actually type: mapped to the canonical name. */
const ALIASES: Record<string, string> = {
  "cote divoire": "Côte d’Ivoire",
  "ivory coast": "Côte d’Ivoire",
  "burkina": "Burkina Faso",
  "rdc": "République démocratique du Congo",
  "congo kinshasa": "République démocratique du Congo",
  "rd congo": "République démocratique du Congo",
  "congo brazzaville": "Congo",
  "republique centrafricaine": "Centrafrique",
  "usa": "États-Unis",
  "us": "États-Unis",
  "etats unis d amerique": "États-Unis",
  "united states": "États-Unis",
  "uk": "Royaume-Uni",
  "united kingdom": "Royaume-Uni",
  "angleterre": "Royaume-Uni",
  "morocco": "Maroc",
  "senegal": "Sénégal",
  "tunisia": "Tunisie",
  "algeria": "Algérie",
  "benin": "Bénin",
  "germany": "Allemagne",
  "spain": "Espagne",
  "switzerland": "Suisse",
  "belgium": "Belgique",
  "netherlands": "Pays-Bas",
  "hollande": "Pays-Bas",
  "china": "Chine",
  "japan": "Japon",
  "italy": "Italie",
  "egypt": "Égypte",
  "south africa": "Afrique du Sud",
  "emirats": "Émirats arabes unis",
  "cap vert": "Cap-Vert",
  "tchequie": "Tchéquie",
  "republique tcheque": "Tchéquie",
  "birmanie myanmar": "Birmanie",
  "myanmar": "Birmanie",
};

/** Lowercase, no accents, apostrophes and hyphens read as spaces. */
export function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’'`´\-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_KEY = new Map(COUNTRIES.map((name) => [normalizeKey(name), name]));

/** "maroc", "Morocco", "cote d'ivoire" → the canonical name; null when it is not a country. */
export function findCountry(input: string): string | null {
  const key = normalizeKey(input);
  if (!key) return null;
  return BY_KEY.get(key) ?? ALIASES[key] ?? null;
}
