# Sauvegardes chiffrées hors OCI (Cloudflare R2)

Aujourd'hui VM1, VM2 et l'A1 sont dans **le même compte OCI** : un seul blocage du compte les
emporterait toutes. `lsnb-backup` envoie chaque nuit une copie **chiffrée** de la base, des fichiers et
de la configuration (dont le `.env` avec les clés) vers un autre fournisseur.

```
 VM1 (production) ── lsnb-backup run (03 h 40 UTC) ──►  Cloudflare R2  ◄── lsnb-backup verify (A1, 08 h UTC)
   chiffre avec la clé PUBLIQUE                         lsnb/db-…age  storage-…age  config-…age  *.sha256
   (ne peut pas relire ses sauvegardes)                 (illisible sans la clé PRIVÉE, gardée hors serveur)
```

| Archive | Contenu | Envoyée |
|---|---|---|
| `db-…sql.gz.age` | Membres, sessions, tables du site, métadonnées du stockage (même format que la synchro) | chaque nuit |
| `storage-…tar.gz.age` | Avatars, PDF, images, avec leurs attributs | si elle a changé, sinon au moins 1 fois par semaine |
| `config-…tar.gz.age` | `docker-compose.yml`, **`.env`**, `volumes/api`, scripts SQL d'initialisation, modèles d'e-mail | idem |
| `extra-…tar.gz.age` | Fichiers annexes de `EXTRA_PATHS` (ex. Nginx) | idem |

Historique : 30 jours au quotidien, puis la copie du 1er de chaque mois jusqu'à 400 jours.

## 1. Cloudflare R2

1. Tableau de bord Cloudflare → **R2 Object Storage**. Cloudflare peut demander un moyen de paiement
   pour activer R2, même sans facturation tant que vous restez dans le palier gratuit (10 Go de
   stockage ; votre base et vos fichiers n'en font aujourd'hui que quelques Mo).
2. **Créer un bucket** : `lsnb-backups`, classe « Standard » (le gratuit ne couvre que celle-là).
3. **Créer deux jetons API**, chacun **limité à ce bucket** :
   - **Object Read & Write** → pour la machine qui sauvegarde (VM1) ;
   - **Object Read only** → pour la machine qui vérifie (A1).
4. Notez pour chacun : *Access Key ID*, *Secret Access Key*, et l'adresse S3 du compte
   (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

Sur chaque machine, `sudo apt install -y age rclone`, puis `~/.config/rclone/rclone.conf` (droits `600`) :

```ini
[r2]
type = s3
provider = Cloudflare
access_key_id = …
secret_access_key = …
endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
```

## 2. La clé de chiffrement (une seule fois, de préférence sur votre ordinateur)

```bash
age-keygen -o lsnb-backup-key.txt      # affiche « Public key: age1… »
```

- La ligne `age1…` (clé **publique**) va dans `backup.env`. Elle peut être partagée sans risque.
- Le fichier `lsnb-backup-key.txt` (clé **privée**) est **le seul moyen de relire les sauvegardes**.
  Gardez-en **deux copies** hors des serveurs (gestionnaire de mots de passe de l'équipe, et une
  copie papier ou clé USB chez une autre personne). Sans elle, les sauvegardes sont perdues ; avec
  elle sur un serveur, elles ne protègent plus rien. `lsnb-backup doctor` avertit si une clé privée
  traîne sur la machine.
- Si vous ne pouvez pas installer `age` chez vous, générez la clé sur l'A1, copiez-la hors du
  serveur, puis `shred -u lsnb-backup-key.txt`.

## 3. Installation sur VM1 (la machine qui sauvegarde)

```bash
cd ~/lsnb-alumni-test/deploy/backup
sudo install -m 755 lsnb-backup /usr/local/bin/
mkdir -p ~/.config/lsnb-backup && cp backup.env.example ~/.config/lsnb-backup/backup.env
nano ~/.config/lsnb-backup/backup.env     # clé publique, REMOTE, chemins

lsnb-backup doctor      # écrit, relit et supprime un petit objet de test dans le bucket
lsnb-backup run         # première sauvegarde, à la main
lsnb-backup list
lsnb-backup verify

sudo install -m 644 lsnb-backup.service lsnb-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lsnb-backup.timer
```

## 4. Vérification quotidienne depuis l'A1 (jeton lecture seule)

Une sauvegarde qui s'arrête en silence est le vrai danger. L'A1 contrôle chaque matin que les
sauvegardes de VM1 existent, ont moins de 30 h et sont intactes (somme de contrôle) :

```bash
sudo install -m 755 lsnb-backup /usr/local/bin/
mkdir -p ~/.config/lsnb-backup && cp backup.env.example ~/.config/lsnb-backup/backup.env
nano ~/.config/lsnb-backup/backup.env     # mêmes REMOTE/PREFIX, jeton LECTURE SEULE dans rclone.conf
lsnb-backup doctor --read-only && lsnb-backup verify

sudo install -m 644 lsnb-backup-verify.service lsnb-backup-verify.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lsnb-backup-verify.timer
```

Pour être **prévenus**, créez deux contrôles gratuits sur healthchecks.io (un pour la sauvegarde,
un pour la vérification) et renseignez `HEALTHCHECK_URL` / `VERIFY_HEALTHCHECK_URL`.

## 5. Tester une restauration (tous les trimestres, et avant toute bascule)

Cela ne restaure rien : on vérifie qu'on **sait** relire la sauvegarde avec la clé privée.

```bash
lsnb-backup list
lsnb-backup restore-test db-20261010T034012Z.sql.gz.age --identity ~/lsnb-backup-key.txt
lsnb-backup restore-test config-….tar.gz.age --identity ~/lsnb-backup-key.txt
```

Copiez la clé privée sur la machine le temps du test, puis supprimez-la (`shred -u`).

## 6. En cas de sinistre : reconstruire

1. Une machine neuve avec Docker (l'A1 convient), `rclone` et `age`, le jeton lecture seule.
2. `lsnb-backup fetch config-….tar.gz.age` et `storage-….tar.gz.age`, puis `db-….sql.gz.age` : les
   téléchargements vérifient la somme de contrôle.
3. Déchiffrer avec la clé privée :
   `age -d -i lsnb-backup-key.txt config-….tar.gz.age | tar -xzf - -C ~/supabase/docker`
   (le `.env` et le compose reviennent, avec les mêmes clés : **les sessions restent valides**).
   Mêmes commandes pour les fichiers, vers `volumes/storage`, avec `tar --xattrs --xattrs-include='user.*'`.
4. `docker compose up -d`, puis appliquer les migrations du dépôt (`supabase/migrations/*.sql`).
5. `age -d -i lsnb-backup-key.txt db-….sql.gz.age > db.sql.gz`, puis
   `lsnb-sync restore ./db.sql.gz` (l'outil de la réplique remet les données dans la base).
6. Réinstaller Nginx depuis l'archive `extra`, réémettre le certificat, rebrancher le DNS.

## Sécurité et limites

- **Confidentialité** : la clé privée n'est jamais sur un serveur ; un serveur piraté ne peut pas lire
  l'historique. Les archives contiennent des données personnelles et le `.env` : ne les décompressez
  que sur une machine de confiance.
- **Suppression** : le jeton « Object Read & Write » peut aussi supprimer. Contre une compromission
  de VM1, gardez de temps en temps (chaque mois) une copie téléchargée sur un disque de l'équipe, et
  regardez dans la documentation Cloudflare si un verrouillage du bucket est proposé (non vérifié ici).
- **Cohérence** : la base est copiée par un seul `pg_dump` (cohérente) ; les fichiers sont lus juste
  après. Un fichier ajouté entre les deux sera dans la sauvegarde suivante.
- **Taille** : l'archive des fichiers est préparée dans `~/lsnb-backup` (temporaire) avant envoi :
  prévoyez le double de la taille du stockage en espace libre. `doctor` le vérifie.
- **Après une bascule** : installez le même script sur la nouvelle machine de production avec le
  même `PREFIX` : l'historique continue dans le même dossier du bucket.

## Vérifier le script lui-même

`test/run-tests.sh` l'exécute avec de **vraies clés age**, un vrai `rclone` (un dossier local joue le
bucket) et un vrai PostgreSQL : chiffrement (rien de lisible dans le bucket), restauration avec la
bonne et la mauvaise clé, fichiers inchangés non renvoyés, échecs sans archive partielle, `verify` qui
détecte une archive tronquée, une somme de contrôle absente ou une sauvegarde trop ancienne,
nettoyage de l'historique, clé privée oubliée sur le serveur, jeton en lecture seule.

```bash
deploy/backup/test/run-tests.sh
```

## Variante sans cloud : dossier local + copie sur un PC personnel

Aucun compte ni carte bancaire : `REMOTE` est un dossier local (chemin absolu) au lieu d'un bucket.
`lsnb-backup` passe par rclone, qui traite un chemin local comme n'importe quelle destination.

```bash
# backup.env sur VM1
REMOTE="/home/ubuntu/lsnb-backups"
```

Puis `lsnb-backup doctor` (il crée le dossier), `lsnb-backup run`, minuteur comme d'habitude.
Les archives sont chiffrées avant d'être écrites : les copier ailleurs ne révèle rien.

Points d'attention :

- **Ce n'est plus « hors OCI » tant que la copie n'est pas faite.** Tirez-la depuis le PC
  (`rsync -av --partial ubuntu@VM1:lsnb-backups/lsnb/ ~/lsnb-backups/`, ou `scp -r`), de préférence
  avec une clé SSH dédiée, et plus souvent qu'une fois par mois (hebdomadaire, ou dès que le PC est
  allumé). Une copie mensuelle seule laisse jusqu'à un mois de données exposées.
- Un second exemplaire sur l'A1 (même `rsync`, depuis l'A1) protège d'une panne de VM1, mais pas
  d'un blocage du compte OCI : seule la copie sur le PC en protège.
- `lsnb-backup verify` et `fetch` fonctionnent sur le dossier local. Sur le PC, faites au moins un
  `restore-test <fichier> --identity cle.txt` avec la clé privée pour prouver que vous pouvez
  restaurer sans le serveur.
- La clé privée `age` ne doit jamais se trouver dans le dossier des sauvegardes ni sur un serveur.
