-- Budget CCQ + placements : aucun changement de structure requis.
-- Les nouveaux types sont stockés dans public.entries (kind + data JSONB) :
-- pay_override, vacation_pay, investment_account, investment_event.
-- Les taux salaryRates et les jours ccqHolidays sont dans l'entrée profile.
-- Exécuter ces vérifications dans Supabase > SQL Editor.
-- Vérifier que RLS est activé et que les politiques isolent chaque utilisateur.

select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'entries';

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'entries';

-- Ne pas appliquer de nouvelles politiques sans vérifier la colonne
-- propriétaire existante et les politiques actuelles de votre projet.
-- Ne pas créer de deuxième table : cela risquerait de fragmenter les données.
