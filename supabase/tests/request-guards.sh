#!/usr/bin/env bash
# Tests of the connection-request rules (issue #6) against a REAL PostgreSQL running the REAL migrations.
# Needs: postgresql. Run: supabase/tests/request-guards.sh   (as root it re-runs itself as "postgres")
# Set STOP_BEFORE=<migration prefix> to stop before a migration (to see the tests fail without it).
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$HERE/../migrations" && pwd)"
if [ "$(id -u)" = 0 ]; then
  copy="$(mktemp -d)"; cp -r "$HERE/.." "$copy/supabase"; chmod -R a+rX "$copy"
  exec runuser -u postgres -- env STOP_BEFORE="${STOP_BEFORE:-}" bash "$copy/supabase/tests/request-guards.sh" "$@"
fi

# shellcheck disable=SC2012
PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL introuvable"; exit 2; }
export PATH="$PG_BIN:$PATH"

T="$(mktemp -d)"; PORT=54352; FAILURES=0; PASSES=0
cleanup() { pg_ctl -D "$T/pg" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$T"; }
trap cleanup EXIT
pass() { PASSES=$((PASSES + 1)); printf '  ok   %s\n' "$*"; }
fail() { FAILURES=$((FAILURES + 1)); printf '  FAIL %s\n' "$*"; }

psqlx() { psql -X -At -h "$T" -p $PORT -U postgres -d app -v ON_ERROR_STOP=1 "$@"; }

initdb -D "$T/pg" --auth=trust -U postgres --no-sync -E UTF8 --locale=C.UTF-8 >/dev/null
pg_ctl -D "$T/pg" -o "-p $PORT -k $T -c listen_addresses='' -c fsync=off" -w -l "$T/pg.log" start >/dev/null
psql -X -q -h "$T" -p $PORT -U postgres -c 'create database app' >/dev/null
psqlx -q -f "$HERE/stub.sql" >/dev/null

echo "Préparation : migrations réelles"
for f in "$MIGRATIONS"/*.sql; do
  name="$(basename "$f")"
  if [ -n "${STOP_BEFORE:-}" ] && [[ "$name" > "$STOP_BEFORE" || "$name" == "$STOP_BEFORE"* ]]; then echo "  (arrêt avant $name)"; break; fi
  psqlx -q -f "$f" >/dev/null 2>"$T/mig.err" || { echo "migration $name en échec :"; cat "$T/mig.err"; exit 2; }
done

A=00000000-0000-0000-0000-0000000000a1   # Alice (demandeuse)
B=00000000-0000-0000-0000-0000000000b2   # Bob (destinataire)
C=00000000-0000-0000-0000-0000000000c3   # Carol (propose du mentorat)
D=00000000-0000-0000-0000-0000000000d4   # Dave (compte désactivé)
E=00000000-0000-0000-0000-0000000000e5   # Eve (tierce personne)
for pair in "$A:Alice" "$B:Bob" "$C:Carol" "$D:Dave" "$E:Eve"; do
  psqlx -q -c "insert into auth.users (id,email,raw_user_meta_data) values ('${pair%%:*}','${pair##*:}@x.org','{\"first_name\":\"${pair##*:}\",\"last_name\":\"T\",\"member_role\":\"alumni\"}')"
done
psqlx -q -c "update public.profiles set is_active = true, offers_mentoring = (id = '$C')"
psqlx -q -c "update public.profiles set is_active = false where id = '$D'"

MSG="Bonjour, je voudrais echanger avec vous."   # 20 caracteres au moins, sans apostrophe
OFFER1=11111111-1111-1111-1111-111111111111
OFFER2=22222222-2222-2222-2222-222222222222

# as <uuid> <sql> : runs as a signed-in member (role "authenticated"); prints the result or the error.
as() { local who="$1"; shift
  psqlx -q -c "set role authenticated" -c "set request.jwt.claim.sub = '$who'" -c "$*" 2>&1 || true; }
ok()  { local out; out="$(as "$@")"; if grep -qi "error" <<<"$out"; then fail "$DESC → $out"; else pass "$DESC"; fi; }
err() { local pat="$1" out; shift; out="$(as "$@")"; if grep -qi "$pat" <<<"$out"; then pass "$DESC"; else fail "$DESC (attendu « $pat », obtenu « $out »)"; fi; }
count() { psqlx -c "$1"; }
send() { # send <requester> <recipient> <kind> [extra columns] [extra values]
  echo "insert into public.connection_requests (requester_id, recipient_id, request_kind, message${4:+, $4}) values ('$1','$2','$3','$MSG'${5:+, $5})"; }

echo "1. Qui peut envoyer"
DESC="demande normale (contact)";                      ok "$A" "$(send $A $B contact)"
DESC="auto-demande refusée";                           err "violates" "$A" "$(send $A $A contact)"
DESC="usurpation de l'expéditeur refusée";             err "row-level security" "$A" "$(send $E $B contact)"
DESC="mentorat refusé si le destinataire n'en propose pas"; err "row-level security" "$A" "$(send $A $B mentoring)"
DESC="doublon en attente refusé";                      err "duplicate key" "$A" "$(send $A $B contact)"

echo "2. Une demande ne peut pas arriver déjà répondue (trou corrigé par la migration de l'issue #6)"
DESC="demande déjà « acceptée » refusée";              err "invalid_new_request" "$A" "$(send $A $E contact status "'accepted'")"
DESC="hameçonnage : « acceptée » + faux e-mail refusé"; err "invalid_new_request" "$A" "$(send $A $E contact "status, shared_email, responded_at" "'accepted', 'phish@evil.org', now()")"
DESC="hameçonnage : « acceptée » + faux téléphone refusé"; err "invalid_new_request" "$A" "$(send $A $E contact "status, shared_phone, responded_at" "'accepted', '+22670000000', now()")"
DESC="faux contact sur une demande en attente refusé";  err "invalid_new_request\|violates check" "$A" "$(send $A $E contact shared_email "'phish@evil.org'")"
DESC="fausse date de réponse refusée";                 err "invalid_new_request" "$A" "$(send $A $E contact responded_at "now()")"
DESC="destinataire désactivé refusé";                  err "recipient_unavailable\|row-level security" "$A" "$(send $A $D contact)"

echo "3. Confidentialité (RLS)"
expect_n() { local got; got="$(count "$2")"; if [ "$got" = "$1" ]; then pass "$3"; else fail "$3 (attendu $1, obtenu $got)"; fi; }
DESC="une tierce personne ne voit aucune demande"
out="$(as "$E" "select count(*) from public.connection_requests")"; if [ "$(tail -n 1 <<<"$out")" = "0" ]; then pass "$DESC"; else fail "$DESC ($out)"; fi
DESC="la demandeuse voit ses demandes"
out="$(as "$A" "select count(*) from public.connection_requests")"; if [ "$(tail -n 1 <<<"$out")" = "1" ]; then pass "$DESC"; else fail "$DESC ($out)"; fi
DESC="une tierce personne ne peut pas répondre"
out="$(as "$E" "with u as (update public.connection_requests set status='accepted', shared_email='e@x.org' returning 1) select count(*) from u")"
if [ "$(tail -n 1 <<<"$out")" = "0" ]; then pass "$DESC"; else fail "$DESC ($out)"; fi
DESC="la demandeuse ne peut pas se répondre à elle-même"
out="$(as "$A" "with u as (update public.connection_requests set status='accepted', shared_email='a@x.org' returning 1) select count(*) from u")"
if [ "$(tail -n 1 <<<"$out")" = "0" ]; then pass "$DESC"; else fail "$DESC ($out)"; fi
DESC="le destinataire peut accepter en partageant un contact"
ok "$B" "update public.connection_requests set status='accepted', shared_email='bob@x.org' where requester_id='$A'"

echo "4. Après une acceptation : pas de blocage"
DESC="nouvelle demande immédiate après acceptation"; ok "$A" "$(send $A $B contact)"

echo "5. Après un refus : 24 h d'attente (mentorat et offres)"
DESC="demande de mentorat à Carol";                 ok "$A" "$(send $A $C mentoring)"
DESC="Carol refuse";                                ok "$C" "update public.connection_requests set status='declined' where requester_id='$A' and recipient_id='$C'"
DESC="nouvelle demande de mentorat bloquée";        err "request_cooldown" "$A" "$(send $A $C mentoring)"
DESC="l'indication de fin d'attente est fournie";   err "HINT:  20" "$A" "$(send $A $C mentoring)"
DESC="la demandeuse ne peut pas effacer un refus pour contourner";
out="$(as "$A" "with d as (delete from public.connection_requests where requester_id='$A' and status='declined' returning 1) select count(*) from d")"
if [ "$(tail -n 1 <<<"$out")" = "0" ]; then pass "$DESC"; else fail "$DESC ($out)"; fi
DESC="message sur l'offre 1 à Bob";                 ok "$A" "$(send $A $B contact opportunity_id "'$OFFER1'")"
ok "$B" "update public.connection_requests set status='declined' where requester_id='$A' and opportunity_id='$OFFER1'" >/dev/null || true
DESC="nouveau message sur la même offre bloqué";    err "request_cooldown" "$A" "$(send $A $B contact opportunity_id "'$OFFER1'")"
DESC="message sur une autre offre autorisé";        ok "$A" "$(send $A $B contact opportunity_id "'$OFFER2'")"
DESC="message simple à une autre personne autorisé"; ok "$A" "$(send $A $E contact)"
echo "   (24 h plus tard)"
psqlx -q -c "set session_replication_role = replica" -c "update public.connection_requests set responded_at = now() - interval '25 hours' where status='declined'"
DESC="demande de mentorat autorisée après 24 h";    ok "$A" "$(send $A $C mentoring)"
DESC="message sur l'offre 1 autorisé après 24 h";   ok "$A" "$(send $A $B contact opportunity_id "'$OFFER1'")"

echo "6. Restauration et maintenance (sans membre connecté)"
psqlx -q -c "insert into public.connection_requests (requester_id, recipient_id, request_kind, message, status, shared_email, responded_at) values ('$E','$B','contact','$MSG','accepted','e@x.org', now())" \
  && pass "une restauration peut recréer une demande acceptée" || fail "restauration bloquée"

echo
if [ "$FAILURES" -gt 0 ]; then echo "$FAILURES échec(s) sur $((PASSES + FAILURES)) vérifications."; exit 1; fi
echo "Tout passe : $PASSES vérifications."
