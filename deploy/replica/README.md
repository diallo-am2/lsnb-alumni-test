# Réplique de Supabase (A1 ← VM1)

Ce dossier tient une **copie à jour** du Supabase en production (VM1, le « primaire ») sur une
autre machine (l'A1, la « réplique »). La réplique peut ensuite prendre le relais si le primaire
tombe, ou servir de copie de test réaliste.

```
        VM1 (primaire, E.Micro)                       A1 (réplique)
  ┌─────────────────────────────┐   toutes les heures   ┌──────────────────────────┐
  │ Supabase en production      │ ◄──── SSH (lecture) ──│ lsnb-sync run            │
  │  base + dossier de stockage │                       │  1. compare les structures│
  │ lsnb-export (accès restreint)│                      │  2. garde-fou            │
  └─────────────────────────────┘                       │  3. copie la base        │
                                                        │  4. copie les fichiers   │
                                                        │  5. restaure (1 transaction)
                                                        └──────────────────────────┘
```

La réplique **tire** les données : le primaire n'a aucun accès à la réplique, et la clé SSH de la
réplique ne permet que de lire (voir « Sécurité »).

## Ce qui est copié, ce qui ne l'est pas

| Copié | Pas copié (à avoir identique des deux côtés, voir plus bas) |
|---|---|
| Comptes (`auth`) : membres, mots de passe chiffrés, identités Google, **sessions** | Mots de passe des rôles PostgreSQL |
| Toutes les tables du site (`public`) | Fichiers `.env` et clés (JWT, ANON, SERVICE…) |
| Métadonnées du stockage (`storage`) | Nginx, certificats, DNS |
| Fichiers du stockage (avatars, PDF, images), avec leurs attributs | Migrations internes des services (`schema_migrations`) |
| | Services optionnels (Realtime, Studio…) : rien à copier, ils n'ont pas de données propres |

Les sessions étant copiées, **les membres restent connectés** après une bascule, à condition que
les clés JWT soient les mêmes.

## Prérequis sur la réplique

1. La **même pile Supabase que VM1** tourne sur l'A1 : même `docker-compose`, **mêmes versions
   d'images**, mêmes secrets (`JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`…, copiés de VM1).
   Les images doivent exister en `arm64` (l'A1 est en ARM).
2. Les **migrations du projet** (`supabase/migrations/*.sql`) sont appliquées sur l'A1, dans l'ordre,
   comme sur VM1. `lsnb-sync doctor` compare les structures et dit précisément ce qui manque.
3. `sudo apt install rsync attr` sur l'A1 (et `rsync` sur VM1).

## Installation

### Sur VM1 (le primaire)

```bash
sudo apt install -y rsync
sudo install -d /usr/local/share/lsnb-replica
sudo install -m 644 fingerprint.sql /usr/local/share/lsnb-replica/fingerprint.sql
sudo install -m 755 primary/lsnb-export /usr/local/bin/lsnb-export
sudo install -m 644 primary/lsnb-export.conf.example /etc/lsnb-export.conf
sudoedit /etc/lsnb-export.conf     # nom du conteneur, utilisateur PostgreSQL, dossier de stockage
```

Vérifiez à la main que la commande voit bien la base et les fichiers :

```bash
for c in ping db-version db-counts storage-check; do SSH_ORIGINAL_COMMAND=$c /usr/local/bin/lsnb-export; done
```

Trouvez le dossier de stockage avec `docker compose config | grep -B2 -A2 storage` (volume monté
dans le service `storage`).

### Sur l'A1 (la réplique)

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/lsnb_replica -C lsnb-replica
cat ~/.ssh/lsnb_replica.pub          # à coller sur VM1, voir ci-dessous
```

Sur **VM1**, ajoutez cette ligne à `~/.ssh/authorized_keys` en remplaçant l'IP de l'A1 et la clé :

```
restrict,from="IP_DE_L_A1",command="/usr/local/bin/lsnb-export" ssh-ed25519 AAAA… lsnb-replica
```

Réseau : autorisez l'A1 vers VM1 sur le port 22 dans la *Security List* OCI **et** dans iptables de
VM1 (c'est l'iptables local qui avait causé le « No route to host » de la mise en place). Utilisez
de préférence l'adresse **privée** de VM1.

De retour sur l'A1 :

```bash
sudo apt install -y rsync attr
sudo install -d /usr/local/share/lsnb-replica
sudo install -m 644 fingerprint.sql /usr/local/share/lsnb-replica/fingerprint.sql
sudo install -m 755 replica/lsnb-sync /usr/local/bin/lsnb-sync
mkdir -p ~/.config/lsnb-sync && cp replica/sync.env.example ~/.config/lsnb-sync/sync.env
nano ~/.config/lsnb-sync/sync.env     # IP de VM1, utilisateur de la base, dossier de stockage

lsnb-sync doctor
```

`doctor` ne modifie rien. Il vérifie la connexion, les versions, les droits, la **compatibilité des
structures** et que `rsync` est accepté. Corrigez chaque ligne `ÉCHEC` avant de continuer.

Quand les structures diffèrent, chaque ligne est préfixée par son côté : `primaire : …` n'existe (ou
n'est écrite ainsi) que sur VM1, `réplique : …` que sur l'A1. Une colonne ou une règle présente d'un
seul côté signifie qu'une migration manque sur l'autre. Le contrôle ne dépend pas du rôle PostgreSQL
utilisé de chaque côté (`postgres`, `supabase_admin`…).

### Première synchro, puis automatique

```bash
lsnb-sync run          # à la main, en regardant les messages
lsnb-sync status

sudo install -m 644 replica/lsnb-sync.service replica/lsnb-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lsnb-sync.timer
systemctl list-timers lsnb-sync.timer
journalctl -u lsnb-sync -n 50        # les messages des synchros automatiques
```

Une synchro par heure. La première peut être lancée à la main autant de fois que nécessaire.

## Ce que fait chaque synchro

1. **Compare les structures** (colonnes, contraintes, règles de sécurité, triggers, fonctions).
   Si elles diffèrent, elle s'arrête et affiche la différence : on ne copie jamais des données dans
   une structure différente.
2. **Garde-fou** : si le primaire a perdu plus de la moitié de ses membres ou profils par rapport à
   la réplique, la synchro est refusée pour ne pas propager une catastrophe. `--force` pour passer
   outre, en connaissance de cause.
3. **Copie la base** dans une archive horodatée, et vérifie qu'elle est complète.
4. **Copie les fichiers** (au plus 100 suppressions à la fois ; au-delà, refus).
5. **Restaure en une seule transaction** : en cas d'erreur, la réplique reste exactement comme avant.
   Les triggers du site (création de profil…) sont suspendus pendant la restauration : aucune ligne
   en double, aucun effet de bord.

Les archives servent aussi de **sauvegardes** : une par heure pendant 3 jours, puis celle de 03 h UTC
pendant 30 jours, dans `~/lsnb-sync/dumps` (droits `700`).

## Surveillance

```bash
lsnb-sync status       # code de sortie 1 si la dernière synchro a échoué ou a plus de 3 h
```

Pour être prévenu sans y penser : créez un contrôle gratuit sur healthchecks.io (période 1 h,
délai de grâce 1 h) et renseignez `HEALTHCHECK_URL` dans `sync.env`. Chaque synchro réussie envoie
un signal ; un échec envoie `/fail` ; le silence déclenche l'alerte.

## Revenir en arrière

Une copie plus ancienne peut être remise dans la base **de la réplique** :

```bash
ls ~/lsnb-sync/dumps
lsnb-sync restore db-20261007T030000Z.sql.gz        # demande confirmation
lsnb-sync restore latest --yes
```

À utiliser seulement sur la réplique (jamais sur le primaire en service). Les fichiers du stockage ne
sont pas touchés. Pensez à mettre le minuteur en pause (`sudo systemctl stop lsnb-sync.timer`) pendant
que vous travaillez sur une ancienne copie, sinon la synchro suivante la remplace.

## Sécurité

- La clé de la réplique est limitée par `restrict` + `command=` : pas de shell, pas de redirection de
  port, uniquement les commandes de `lsnb-export` (lecture de la base et du dossier de stockage).
  Les tests vérifient qu'une autre commande ou une sortie du dossier de stockage est refusée.
- Les archives contiennent des données personnelles et des mots de passe chiffrés : droits `700`,
  volume chiffré au repos par OCI. Ne les copiez pas hors de l'infrastructure sans les chiffrer.
- Une réplique avec de vraies données est une **seconde production** : mêmes précautions (ports
  fermés, accès limité). Pour un environnement de test partagé, anonymisez les données.

## Si `doctor` signale des fichiers illisibles

`lsnb-export` lit le stockage avec l'utilisateur SSH. Les fichiers créés par le conteneur
appartiennent à son utilisateur (souvent l'UID 1000, c'est-à-dire `ubuntu`). Si ce n'est pas le cas :

```bash
ls -ln ~/supabase/docker/volumes/storage | head       # à qui appartiennent les fichiers ?
```

Deux solutions : donner la lecture à l'utilisateur SSH (`chmod -R o+rX` sur le dossier, ce qui ouvre
la lecture à tous les comptes de la machine), ou créer un utilisateur dédié appartenant au bon groupe.
Ne donnez pas de `sudo` à la clé de la réplique.

## Vérifier que tout fonctionne vraiment

`test/run-tests.sh` lance les scripts contre **deux vrais serveurs PostgreSQL** et un vrai
`rsync`/`rrsync` (seul `ssh` est simulé) : copie complète, idempotence, suppressions, structure
différente, transfert tronqué, restauration cassée, primaire vidé, retour en arrière, accès
restreint. Il demande `postgresql` et `rsync` (et `attr` pour tester les attributs étendus).

```bash
deploy/replica/test/run-tests.sh
```

Ce test ne remplace pas `lsnb-sync doctor` sur les vraies machines : il valide la logique, `doctor`
valide votre installation.

## Et ensuite (pas encore automatisé)

- **Bascule** : arrêter les écritures sur le primaire, lancer une dernière synchro, démarrer la pile
  sur l'A1, puis changer l'adresse de `supabase.diallo-sec.org` dans Cloudflare. Il faut avant cela un
  certificat valide pour ce domaine **déjà installé sur l'A1** (par exemple certbot en validation DNS),
  et les mêmes clés des deux côtés. À répéter à blanc avant le jour où on en aura besoin.
- **Sens inverse** : une fois l'A1 en production, VM1 devient la réplique ; les scripts sont les
  mêmes (échanger les rôles).
- **Fichiers sur un stockage partagé** (S3 d'OCI) : supprimerait la copie de fichiers.
