# Mon app (PWA)

Entraînements, notes, budget et suppléments. Hébergée gratuitement sur GitHub Pages, données dans Supabase.
Aucun outil à installer : ce sont de simples fichiers (HTML, CSS, JavaScript).

## 1. Préparer Supabase (une seule fois)

1. Ouvre ton projet sur supabase.com, puis **SQL Editor** → **New query**.
2. Copie tout le contenu de `schema.sql`, colle-le, puis clique **Run**.
3. Va dans **Authentication → Users → Add user → Create new user** :
   entre ton courriel et un mot de passe, et coche « Auto Confirm User ».
4. Va dans **Authentication → Sign In / Providers** (ou *Settings*) et **désactive** « Allow new users to sign up »,
   pour que personne d'autre ne puisse créer de compte.

La clé `sb_publishable_...` dans `config.js` est faite pour être publique. Tes données sont protégées par ta connexion
et par les règles du fichier `schema.sql`. Ne mets jamais la clé `secret` ou `service_role` dans ce projet.

## 2. Mettre le code sur GitHub

1. Crée un dépôt sur github.com (**New repository**), par exemple `mon-app`.
2. **Add file → Upload files**, glisse **tous** les fichiers de ce dossier (ils vont tous à la racine, sans sous-dossier), puis **Commit changes**.
3. **Settings → Pages** : *Source* = « Deploy from a branch », branche `main`, dossier `/ (root)`, puis **Save**.
4. Après 1 à 2 minutes, ton app est à `https://TON-NOM.github.io/mon-app/`.

## 3. L'installer sur ton iPhone

1. Ouvre l'adresse dans **Safari**.
2. Touche **Partager** → **Sur l'écran d'accueil**.
3. Ouvre l'app depuis l'icône et connecte-toi avec le courriel et le mot de passe de l'étape 1.

## Mettre à jour l'app

Remplace les fichiers modifiés sur GitHub. Si l'iPhone garde l'ancienne version, change le numéro dans `sw.js`
(`const CACHE = 'app-v2'`), ou va dans **Réglages → Vider le cache de l'app**.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `index.html`, `style.css` | Page et design (thèmes clair et sombre) |
| `app.js` | Menu, navigation, connexion |
| `db.js` | Connexion à Supabase |
| `view-*.js` | Un fichier par section (entraînements, notes, budget, suppléments, profil, réglages) |
| `sw.js`, `manifest.json` | Installation sur l'écran d'accueil et cache |
| `schema.sql` | Table Supabase et règles de sécurité |

Les icônes viennent de Tabler Icons et Supabase est chargé depuis jsDelivr, donc la toute première ouverture demande Internet.
