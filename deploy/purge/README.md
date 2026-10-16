# Purge des comptes supprimés

Le profil est masqué immédiatement. Le membre peut annuler pendant 30 jours, puis ce script supprime définitivement les fichiers par l'API Storage et le compte par l'API Admin Auth. Les cascades retirent ensuite les profils, demandes, offres et snapshots.

Le script n'a aucune dépendance : Node 24, pas de build.

```bash
sudo mkdir -p /etc/lsnb
sudo cp deploy/purge/purge.env.example /etc/lsnb/purge.env
sudo chmod 600 /etc/lsnb/purge.env
sudo cp deploy/purge/lsnb-purge.service deploy/purge/lsnb-purge.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lsnb-purge.timer
```

Configurer `SUPABASE_URL` et `SUPABASE_SECRET_KEY` dans `/etc/lsnb/purge.env`. Vérifier avec :

```bash
node api/scripts/purge-deleted-accounts.mjs --dry-run
systemctl list-timers lsnb-purge.timer
```

La migration `202610160001_account_deletion_v2.sql` doit être appliquée avant l'installation.
