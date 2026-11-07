<div align="center">

# APL TV pour Tizen OS

**Un lecteur IPTV façon Apple TV pour les téléviseurs et Smart Monitors Samsung sous Tizen.**
La TV en direct, les films et les séries de tes propres playlists M3U et comptes Xtream, dans le style d'[APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS) : look tvOS, Liquid Glass, animations et sons, tout à la télécommande.

Créé par **Knikt** (Gero Corp.), l'auteur d'[APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS)

![APL TV : l'accueil, la fiche d'un titre, la TV en direct et le lecteur](docs/images/home.jpg)

[Fonctions](#fonctions) · [Captures](#captures-décran) · [Prérequis](#prérequis) · [Installation](#installation) · [Ajouter ta playlist](#ajouter-ta-playlist) · [APL Launcher](#par-lauteur-dapl-launcher) · [Vie privée](#vie-privée-et-sécurité) · [English](README.md)

</div>

---

> **APL TV est seulement un lecteur.** Il ne contient aucune chaîne, aucune playlist et aucun fournisseur : tu ajoutes les tiens. Utilise-le uniquement avec des contenus que tu as le droit de regarder.

## Fonctions

- **Accueil façon Apple TV.** Un grand titre à la une (image de fond, logo du titre, âge conseillé, note IMDb, résumé), puis Reprendre, À suivre pour tes séries, Chaînes favorites avec ce qui passe, Ma liste, Nouveaux films, Nouvelles séries, Les mieux notés et des rangées par genre (anime, K-drama, studios comme Ghibli ou Pixar, séries Netflix, HBO…).
- **TV en direct.** La chaîne sur laquelle tu es passe en plein écran derrière l'interface, avec son programme, le temps restant et la suite. Catégories (Favoris, Récentes, puis les tiennes, ta langue d'abord), touches numériques, chaîne précédente, et les versions 4K / FHD / HD d'une chaîne sur une seule carte.
- **Guide TV** en grille, depuis le guide XMLTV de ton fournisseur (ou le guide court d'Xtream), avec epg.pw et iptv-epg.org pour les chaînes qui n'en ont pas.
- **Multiview :** jusqu'à 4 chaînes en même temps (le nombre dépend de la puce de ton écran et de ton abonnement).
- **Films et séries.** Les catégories de ton fournisseur, les affiches avec leur note IMDb, et une page par titre : le vrai résumé dans ta langue (TMDB), les saisons et épisodes avec ceux que tu as vus cochés, la saga du film, Titres similaires pris dans ton propre catalogue, le réalisateur et les acteurs, et une page pour chaque acteur. Les versions d'un même titre (langues, 4K) sont regroupées : celle dans ta langue, dans la meilleure qualité que ton écran affiche, est choisie, et celle que tu choisis est retenue. Un bouton Trier (ajoutés récemment, de A à Z, année, note).
- **Le lecteur.** Menus Sous-titres et Audio pendant la lecture (films, séries et chaînes en direct), téléchargement OpenSubtitles avec réglage du décalage (jamais choisi par défaut), style des sous-titres, avance et retour précis (par 10 s, plus vite en restant appuyé), épisode précédent et suivant, une carte « Épisode suivant » avec une image qui ne dévoile rien, une minuterie de mise en veille, le format de l'image (adapter, remplir l'écran, format d'origine). Rien ne se lance tout seul, sauf si tu actives la lecture automatique.
- **Reprendre là où tu t'es arrêté.** À l'ouverture, APL TV te propose le film ou l'épisode que tu regardais, à la minute où tu t'es arrêté, ou la dernière chaîne.
- **L'âge conseillé selon les règles de ton pays** (France -12 / -16, États-Unis PG-13 / R, Allemagne FSK 16…), converti depuis les pays voisins quand le tien n'en a pas.
- **Masquer ce que tu ne veux pas voir.** Les catégories adultes sont masquées par défaut. Dans les Réglages, tu peux masquer des thèmes entiers (violence, horreur, drogues, gore… 20 thèmes, reconnus grâce aux mots-clés TMDB et aux noms de catégories de ton fournisseur) et des titres un par un : ils disparaissent partout, recherche comprise. Les pays et les catégories aussi : Réglages > Pays et catégories liste les pays et régions de tes playlists, tu masques tout un pays ou seulement certaines de ses catégories (ou OK maintenu sur une catégorie). Tes chaînes favorites restent.
- **Tri intelligent.** La langue de l'écran d'abord (`EU| FR| Sport` est lu comme français), séparateurs ignorés, noms des fournisseurs nettoyés.
- **Recherche** dans les chaînes, films et séries avec un clavier à l'écran. Accents et majuscules ne comptent pas.
- **À la voix, avec l'Alexa de l'écran :** « Alexa, pause », lecture, avance, épisode suivant arrivent directement dans APL TV. Pour les recherches, que l'Alexa de Samsung garde pour son propre panneau, la petite [skill APL TV](alexa-skill/) les amène dans APL TV : « Alexa, demande à APL TV de chercher les films Dragon Ball » et les résultats sont à l'écran ; « Alexa, demande à APL TV de mettre M6 » et la chaîne démarre. Avec Bixby, les recherches devraient arriver dans APL TV sans la skill (pas encore testé).
- **Configuration depuis le téléphone.** L'écran affiche un QR code ; ton téléphone ouvre une page servie par l'écran lui-même sur ton Wi-Fi (aucun site extérieur), protégée par un code à usage unique. La télécommande marche aussi.
- **Intégration à APL Launcher.** Sur l'écran d'accueil d'APL Launcher, le Top Shelf d'APL TV montre ce que tu regardais et ta dernière chaîne, et OK l'ouvre directement là (APL Launcher 1.0.20 ou plus récent).
- **Mises à jour automatiques.** APL TV regarde ce dépôt toutes les 6 heures et se met à jour tout seul (code, style, textes), puis redémarre quand rien n'est en lecture. Tes playlists et tes réglages restent. Une mise à jour qui change les permissions de l'app demande une fois APL Launcher Setup. Réglages › Mises à jour.
- En français et en anglais (suit la langue de l'écran).

## Captures d'écran

| | |
|---|---|
| ![Accueil](docs/images/home-rows.jpg) **Accueil :** Reprendre, Chaînes favorites et d'autres rangées sous le titre à la une. | ![Fiche d'un titre](docs/images/title.jpg) **Fiche d'un titre :** logo, âge conseillé, IMDb, résumé, réalisateur et acteurs, Titres similaires. |
| ![Séries](docs/images/series.jpg) **Séries :** saisons, épisodes avec leur image et leur résumé, les acteurs. | ![Films](docs/images/movies.jpg) **Films :** tes catégories et des genres intelligents, la note IMDb sur chaque affiche. |
| ![TV en direct](docs/images/live.jpg) **TV en direct :** la chaîne passe derrière, avec ce qui passe et la suite. | ![Guide TV](docs/images/guide.jpg) **Guide TV :** une grille des prochaines heures, la chaîne derrière. |
| ![Lecteur](docs/images/player.jpg) **Le lecteur :** barre façon Apple TV, avance précise, heure de fin. | ![Sous-titres](docs/images/subtitles.jpg) **Sous-titres :** pistes de la vidéo, OpenSubtitles, décalage et style. |
| ![Recherche](docs/images/search.jpg) **Recherche :** chaînes, films et séries d'un coup, au clavier ou à la voix. | ![Vue d'ensemble](docs/images/overview.jpg) **Tout à la télécommande**, avec le style d'APL Launcher. |

Les captures n'utilisent que du contenu de démonstration : des films libres de la Blender Foundation (CC BY) et des classiques du domaine public, avec des noms de chaînes inventés. APL TV lui-même ne contient rien à regarder.

## Prérequis

- Un téléviseur ou Smart Monitor Samsung sous Tizen (Tizen 6 ou plus récent). Testé sur un Smart Monitor M8 ; dis-nous dans une [issue](../../issues) comment il marche sur le tien.
- **Pas de root.** APL TV est une app ordinaire : elle s'installe en mode développeur, comme n'importe quelle app ajoutée avec Tizen Studio. Vetro ne sert que s'il est déjà sur ton écran, pour installer sans le mode développeur.
- Un certificat Samsung pour ton écran (Certificate Manager de Tizen Studio, ou Apps2Samsung) : un écran du commerce n'installe que les apps signées pour lui.
- Facultatif mais conseillé : une [clé API TMDB](https://www.themoviedb.org/settings/api) gratuite pour les affiches, résumés, acteurs, âges conseillés et Titres similaires. Sans elle, APL TV lit tout quand même, avec les affiches de ton fournisseur.

## Installation

### Avec APL Launcher Setup (conseillé)

Dans [APL Launcher Setup](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest), page Installer, active **Installer aussi APL TV**. Setup télécharge la dernière version publiée ici, vérifie son SHA256, ajoute ta clé TMDB ainsi que les polices et les sons d'APL Launcher, la signe avec ton certificat et l'installe sur l'écran (par Vetro s'il est là, sinon en mode développeur). Relancer l'installation met APL TV à jour et garde tes playlists.

Depuis le dossier d'APL Launcher, APL TV seul :

```powershell
.\scripts\06-install-apltv.ps1 -TvIp 192.168.1.50 -ProfileName <ton profil de signature>
```

### À la main, en mode développeur

Active le mode développeur sur l'écran (Applis, puis 1 2 3 4 5 sur la télécommande, Host PC IP = l'adresse de ce PC), puis télécharge `apl-tv-vX.Y.Z.wgt` dans les [Releases](../../releases/latest). Il est signé avec le certificat par défaut du SDK Tizen : signe-le à nouveau pour ton écran, puis installe-le, par exemple avec le CLI de Tizen Studio :

```powershell
tizen package -t wgt -s <ton profil de signature> -- apl-tv-vX.Y.Z.wgt
sdb connect <adresse de l'écran>
tizen install -n apl-tv-vX.Y.Z.wgt -t <ton écran>
```

Ta clé TMDB se tape ensuite dans APL TV : Réglages › Clé TMDB.

### Depuis le code source

Copie `app/js/keys.example.js` en `app/js/keys.local.js` et mets-y ta clé TMDB, puis :

```powershell
.\tools\build.ps1 -TizenCli <chemin de tizen.bat> -Profile <ton profil de signature> -Install -Ip 192.168.1.50 -Launch
```

`-Install` passe par Vetro si l'écran l'a, sinon par le mode développeur (sdb). `-Dev` ajoute un journal de développement et une télécommande de test servie par l'assistant sur le port 8765 (jamais pour l'usage de tous les jours). `tools/check.py` fait les mêmes vérifications que GitHub Actions.

Organisation : `app/` est l'app web Tizen (ES5), `app/service/service.js` son service d'assistance (un service web Tizen : la page du téléphone, les guides TV compressés, les fournisseurs sans CORS). Les fichiers personnels ne sont jamais dans le dépôt : `app/js/keys.local.js`, les polices SF Pro et les sons de l'interface.

## Ajouter ta playlist

APL TV › Réglages › Playlists › Ajouter une playlist › **Depuis le téléphone** : scanne le QR code avec ton téléphone (sur le même Wi-Fi que l'écran), tape ou colle ton lien M3U, ou ton serveur, nom d'utilisateur et mot de passe Xtream, puis appuie sur Envoyer à l'écran. Tu peux ajouter plusieurs playlists. Un lien M3U qui est en fait un lien Xtream (`get.php?username=…`) est lu comme Xtream, avec affiches, résumés et guide TV.

## Par l'auteur d'APL Launcher

APL TV est fait par Knikt (Gero Corp.), qui fait aussi **[APL Launcher pour Tizen OS](https://github.com/Knikt/APL-Launcher-for-TizenOS)** : un écran d'accueil façon Apple TV pour les téléviseurs et Smart Monitors Samsung sous Tizen, avec un Top Shelf en direct pour chaque app, un dock en verre, un Centre de contrôle par-dessus n'importe quelle app, des Réglages et des Sources façon Apple TV, des profils pour toute la maison avec Memoji, et Alexa sur le bouton micro de la télécommande. Son installateur Windows, APL Launcher Setup, met tout sur l'écran en quelques minutes.

Les deux sont faits pour aller ensemble :

- APL TV a le style du launcher, ses sons et ses polices.
- Sur l'écran d'accueil du launcher, le Top Shelf d'APL TV montre le film ou l'épisode que tu regardais, à sa minute, et ta dernière chaîne. OK l'ouvre directement là.
- APL Launcher Setup installe APL TV d'un seul interrupteur, avec ta clé TMDB, et le tient à jour.

Si APL TV te plaît, jette un œil à APL Launcher, et une étoile sur l'un ou l'autre dépôt fait toujours plaisir.

## Vie privée et sécurité

- Tes playlists et tes comptes restent sur l'écran, dans le stockage d'APL TV. Ils ne sont envoyés qu'à ton fournisseur et ne sont jamais écrits dans les journaux.
- APL TV ne parle qu'à ton fournisseur, à TMDB et à Cinemeta de Stremio (pour reconnaître les titres), aux sources du guide TV, à OpenSubtitles par l'add-on public de Stremio (seulement quand tu cherches des sous-titres), à GitHub toutes les 6 heures pour chercher une mise à jour (Réglages › Mises à jour pour l'éteindre), et, seulement si tu actives la skill Alexa, à ton sujet ntfy.sh privé (uniquement les mots cherchés).
- Le service d'assistance sur l'écran (port 8765) ne répond qu'à APL TV, et à la page du téléphone tant qu'un code de configuration est affiché. Les sites ouverts dans le navigateur de l'écran sont refusés. Le code est aléatoire, change à chaque fois, et trop de mauvais codes le ferment.
- Pas de compte, pas de statistiques, pas de pub.

## Crédits

APL TV est fait par **Knikt** (Gero Corp.)

- Données et images des films et séries : [TMDB](https://www.themoviedb.org). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
- Notes IMDb par Cinemeta de Stremio ; sous-titres d'[OpenSubtitles](https://www.opensubtitles.org) par l'add-on OpenSubtitles de Stremio.
- Guides TV : le XMLTV de ton fournisseur, [epg.pw](https://epg.pw) et [iptv-epg.org](https://iptv-epg.org).
- Le style, les sons et les polices viennent d'APL Launcher.

APL TV n'est affilié ni à Apple, ni à Samsung, TMDB, OpenSubtitles, Stremio ou un fournisseur IPTV. Les noms et logos appartiennent à leurs propriétaires.

## Licence

[MIT](LICENSE). Les polices SF Pro et les sons de l'interface ne font pas partie de ce dépôt : APL Launcher Setup copie ceux que tu as.
