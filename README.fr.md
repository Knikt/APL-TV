<div align="center">

# APL TV

**Un lecteur IPTV façon Apple TV pour Samsung, LG et Android TV.**
La TV en direct, les films et les séries de tes propres playlists M3U et comptes Xtream, dans le style d'[APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS) : look tvOS, Liquid Glass, animations et sons, tout à la télécommande.

**Samsung** (TV et Smart Monitors Tizen) · **LG** (TV webOS) · **Android TV**, Google TV et Fire TV

Créé par **Knikt** (Gero Corp.), l'auteur d'[APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS)

![APL TV : l'accueil, la fiche d'un titre, la TV en direct et le lecteur](docs/images/home.jpg)

[Fonctions](#fonctions) · [Captures](#captures-décran) · [Ta TV](#samsung-lg-ou-android) · [Installation](#installation) · [Ajouter ta playlist](#ajouter-ta-playlist) · [APL Launcher](#par-lauteur-dapl-launcher) · [Vie privée](#vie-privée-et-sécurité) · [English](README.md)

</div>

---

> **APL TV est seulement un lecteur.** Il ne contient aucune chaîne, aucune playlist et aucun fournisseur : tu ajoutes les tiens. Utilise-le uniquement avec des contenus que tu as le droit de regarder.

## Fonctions

La même app sur chaque TV : même look, mêmes fonctions, mêmes mises à jour.

- **Accueil façon Apple TV.** Un grand titre à la une parmi ce que tout le monde regarde cette semaine (image de fond, logo du titre, âge conseillé, note IMDb, résumé), puis Reprendre, À suivre pour tes séries, Chaînes favorites avec ce qui passe, Ma liste, Films et Séries tendance, les nouveautés, Les mieux notés et des rangées par genre (anime, K-drama, studios comme Ghibli ou Pixar, séries Netflix, HBO…).
- **TV en direct.** La chaîne sur laquelle tu es passe en plein écran derrière l'interface, avec son programme, le temps restant et la suite. Catégories (Favoris, Récentes, puis les tiennes, ta langue d'abord), touches numériques, chaîne précédente, et les versions 4K / FHD / HD d'une chaîne sur une seule carte.
- **Guide TV** en grille, depuis le guide XMLTV de ton fournisseur (ou le guide court d'Xtream), avec epg.pw et iptv-epg.org pour les chaînes qui n'en ont pas.
- **Films et séries.** Les catégories de ton fournisseur, les affiches avec leur note IMDb, et une page par titre : le vrai résumé dans ta langue (TMDB), les saisons et épisodes avec ceux que tu as vus cochés, la saga du film, Titres similaires pris dans ton propre catalogue, le réalisateur et les acteurs, et une page pour chaque acteur. Les versions d'un même titre (langues, 4K) sont regroupées : celle dans ta langue, dans la meilleure qualité que ton écran affiche, est choisie, et celle que tu choisis est retenue. Un bouton Trier (ajoutés récemment, de A à Z, année, note).
- **Le lecteur.** Menus Sous-titres et Audio pendant la lecture (films, séries et chaînes en direct), téléchargement OpenSubtitles avec réglage du décalage (jamais choisi par défaut), style des sous-titres, avance et retour précis (par 10 s, plus vite en restant appuyé), épisode précédent et suivant, une carte « Épisode suivant » avec une image qui ne dévoile rien, une minuterie de mise en veille, le format de l'image (adapter, remplir l'écran, format d'origine). Les flux à plusieurs qualités démarrent à la meilleure. Rien ne se lance tout seul, sauf si tu actives la lecture automatique.
- **Reprendre là où tu t'es arrêté.** À l'ouverture, APL TV te propose le film ou l'épisode que tu regardais, à la minute où tu t'es arrêté, ou la dernière chaîne.
- **Protection des écrans OLED.** APL TV reconnaît une TV OLED (LG le dit lui-même ; les Samsung, Sony et Philips OLED par leur modèle) et la protège du marquage : l'interface se décale de quelques pixels toutes les 2 minutes, et après 5 minutes sans télécommande quand rien ne joue, un économiseur montre des images de ton catalogue qui défilent lentement, avec l'heure dans un coin qui change toutes les quelques minutes. Réglages › Protection de l'écran (Automatique, Activée, Désactivée).
- **L'âge conseillé selon les règles de ton pays** (France -12 / -16, États-Unis PG-13 / R, Allemagne FSK 16…), converti depuis les pays voisins quand le tien n'en a pas.
- **Masquer ce que tu ne veux pas voir.** Les catégories adultes sont masquées par défaut. Dans les Réglages, tu peux masquer des thèmes entiers (violence, horreur, drogues, gore… 20 thèmes, reconnus grâce aux mots-clés TMDB et aux noms de catégories de ton fournisseur) et des titres un par un : ils disparaissent partout, recherche et tendances comprises. Les pays et les catégories aussi : Réglages > Pays et catégories liste les pays et régions de tes playlists, tu masques tout un pays ou seulement certaines de ses catégories (ou OK maintenu sur une catégorie). Tes chaînes favorites restent.
- **Tri intelligent.** La langue de l'écran d'abord (`EU| FR| Sport` est lu comme français), séparateurs ignorés, noms des fournisseurs nettoyés.
- **Recherche** dans les chaînes, films et séries avec un clavier à l'écran. Accents et majuscules ne comptent pas.
- **À la voix avec Alexa.** La petite [skill APL TV](alexa-skill/) amène tes recherches et tes chaînes dans APL TV, sur n'importe quelle TV : « Alexa, demande à APL TV de chercher les films Dragon Ball » et les résultats sont à l'écran ; « Alexa, demande à APL TV de mettre M6 » et la chaîne démarre. Sur Samsung, l'Alexa de l'écran arrive aussi directement dans APL TV pour « Alexa, pause », lecture, avance et épisode suivant.
- **Configuration depuis le téléphone.** La TV affiche un QR code ; ton téléphone ouvre une page servie par la TV elle-même sur ton Wi-Fi (aucun site extérieur), protégée par un code à usage unique. La télécommande marche aussi.
- **Mises à jour automatiques.** APL TV regarde ce dépôt toutes les 6 heures et se met à jour tout seul (code, style, textes), puis redémarre quand rien n'est en lecture. Tes playlists et tes réglages restent. Chaque TV ne prend que les mises à jour prêtes pour elle ; quand sa partie installée change, elle demande une fois une nouvelle installation. Réglages › Mises à jour.
- En français et en anglais (suit la langue de la TV).

## Captures d'écran

| | |
|---|---|
| ![Accueil](docs/images/home-rows.jpg) **Accueil :** Reprendre, Chaînes favorites et d'autres rangées sous le titre à la une. | ![Fiche d'un titre](docs/images/title.jpg) **Fiche d'un titre :** logo, âge conseillé, IMDb, résumé, réalisateur et acteurs, Titres similaires. |
| ![Séries](docs/images/series.jpg) **Séries :** saisons, épisodes avec leurs propres images et résumés, les acteurs. | ![Films](docs/images/movies.jpg) **Films :** tes catégories et des genres intelligents, la note IMDb sur chaque affiche. |
| ![TV en direct](docs/images/live.jpg) **TV en direct :** la chaîne passe derrière, ce qui passe et la suite. | ![Guide TV](docs/images/guide.jpg) **Guide TV :** une grille des prochaines heures, la chaîne derrière. |
| ![Lecteur](docs/images/player.jpg) **Le lecteur :** barre façon Apple TV, avance précise, heure de fin. | ![Sous-titres](docs/images/subtitles.jpg) **Sous-titres :** les pistes de la vidéo, OpenSubtitles, décalage et style. |
| ![Recherche](docs/images/search.jpg) **Recherche :** chaînes, films et séries en même temps, au clavier ou à la voix. | ![Vue d'ensemble](docs/images/overview.jpg) **Tout à la télécommande**, dans le look d'APL Launcher. |

Les captures n'utilisent que du contenu de démonstration : des films libres de la Blender Foundation (CC BY) et des classiques du domaine public, avec des noms de chaînes inventés. APL TV lui-même ne contient rien à regarder.

## Samsung, LG ou Android

| | Samsung (Tizen 6 ou plus récent) | LG (webOS) | Android TV, Google TV, Fire TV |
|---|---|---|---|
| Paquet | `apl-tv-vX.Y.Z.wgt` | `apl-tv-vX.Y.Z-lg-webos.ipk` | `apl-tv-vX.Y.Z-android.apk` |
| Root nécessaire | Non | Non | Non |
| Lecteur vidéo | AVPlay de Samsung | Le lecteur de LG | ExoPlayer |
| Voix | L'Alexa de l'écran + la skill APL TV | La skill APL TV | La skill APL TV |
| Multiview (plusieurs chaînes) | Oui | Pas encore | Non |
| Top Shelf d'APL Launcher | Oui | Non (APL Launcher est pour Samsung) | Non |
| Télécommande | Toutes les touches | Toutes les touches ; le pointeur de la Magic Remote n'est pas encore utilisé | Toutes les touches |
| Sous-titres intégrés à la vidéo | Oui | Oui, affichés par la TV | Oui |
| Testé sur | Smart Monitor M8 (Tizen 9) | OLED G5 (webOS 25) | Android TV 14 (émulateur) |

Dis-nous dans une [issue](../../issues/new/choose) comment ça tourne sur la tienne : le formulaire demande ta TV, et chaque issue et pull request reçoit l'étiquette de sa TV. Issues pour [Samsung](../../issues?q=is%3Aissue+label%3Asamsung), [LG](../../issues?q=is%3Aissue+label%3Alg-webos), [Android TV](../../issues?q=is%3Aissue+label%3Aandroid-tv) ; pull requests pour [Samsung](../../pulls?q=is%3Apr+label%3Asamsung), [LG](../../pulls?q=is%3Apr+label%3Alg-webos), [Android TV](../../pulls?q=is%3Apr+label%3Aandroid-tv).

Facultatif sur chaque TV, mais conseillé : une [clé API TMDB](https://www.themoviedb.org/settings/api) gratuite pour les affiches, résumés, acteurs, âges conseillés, tendances et Titres similaires. Sans elle, APL TV lit tout quand même, avec les affiches de ton fournisseur. Tape-la dans APL TV › Réglages › Clé TMDB.

## Installation

Télécharge le paquet de ta TV dans les [Releases](../../releases/latest). Chacun a son SHA256 (`SHA256SUMS-*.txt`).

### Samsung (Tizen)

**Pas de root.** APL TV est une app ordinaire : elle s'installe en mode développeur. Un écran du commerce n'installe que les apps signées pour lui : il te faut un certificat Samsung pour ton écran (Certificate Manager de Tizen Studio, ou Apps2Samsung).

- **Avec APL Launcher Setup (conseillé).** Dans [APL Launcher Setup](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest), page Installation, active **Installer aussi APL TV**. Setup télécharge la dernière version ici, vérifie son SHA256, ajoute ta clé TMDB et les polices et sons d'APL Launcher, la signe avec ton certificat et l'installe sur l'écran (par Vetro s'il est là, sinon en mode développeur). Relancer l'installation met APL TV à jour et garde tes playlists. Depuis le dossier d'APL Launcher, APL TV seul : `.\scripts\06-install-apltv.ps1 -TvIp 192.168.1.50 -ProfileName <ton profil de signature>`
- **Avec Apps2Samsung.** APL TV est dans son catalogue.
- **À la main, en mode développeur.** Active le mode développeur sur l'écran (Apps, puis 1 2 3 4 5 sur la télécommande, Host PC IP = l'adresse de ce PC), puis signe à nouveau `apl-tv-vX.Y.Z.wgt` pour ton écran et installe-le, par exemple avec la ligne de commande de Tizen Studio :

```powershell
tizen package -t wgt -s <ton profil de signature> -- apl-tv-vX.Y.Z.wgt
sdb connect <adresse de l'écran>
tizen install -n apl-tv-vX.Y.Z.wgt -t <ton écran>
```

### LG (webOS)

**Pas de root.** APL TV s'installe comme toute app faite pour les TV LG, en mode développeur :

1. Sur la TV, installe **Developer Mode** depuis le LG Content Store et connecte-toi avec un [compte développeur LG](https://webostv.developer.lge.com) gratuit. Active **Dev Mode Status**, puis **Key Server**.
2. Sur ton PC, installe les outils webOS de LG ([Node.js](https://nodejs.org) nécessaire) : `npm install -g @webos-tools/cli`, ou utilise l'app communautaire [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) à la place des commandes ci-dessous.
3. Ajoute la TV et récupère sa clé (la phrase secrète est affichée dans l'app Developer Mode), puis installe :

```powershell
ares-setup-device --add tv -i "host=<adresse de la TV>" -i "port=9922" -i "username=prisoner"
ares-novacom --device tv --getkey
ares-install --device tv apl-tv-vX.Y.Z-lg-webos.ipk
```

Le mode développeur de LG dure un nombre d'heures limité : appuie de temps en temps sur **Extend Session Time** dans l'app Developer Mode, sinon LG désactive les apps que tu as installées (tes playlists restent). Chaque version contient aussi `apl-tv.manifest.json`, le manifeste qu'utilise le Homebrew Channel de webOS.

### Android TV, Google TV et Fire TV

**Pas de root.** Installe le `.apk` comme toute app venant d'ailleurs que le store :

- **Sur la TV :** avec une app comme Downloader, ouvre le lien de `apl-tv-vX.Y.Z-android.apk` dans les Releases et installe-le (Android demande une fois d'autoriser les apps de cette source).
- **Depuis un PC :** active les options pour les développeurs de la TV, puis `adb connect <adresse de la TV>` et `adb install apl-tv-vX.Y.Z-android.apk`.

Un `.apk` plus récent s'installe par-dessus l'ancien et garde tes playlists. Tous les `.apk` d'APL TV sont signés avec la même clé.

### Depuis le code source

Copie `app/js/keys.example.js` en `app/js/keys.local.js` et mets-y ta clé TMDB, puis fabrique pour ta TV :

```powershell
.\tools\build.ps1 -TizenCli <chemin de tizen.bat> -Profile <ton profil de signature> -Install -Ip 192.168.1.50 -Launch   # Samsung
python tools/make-webos.py      # LG : dist/com.knikt.apltv_X.Y.Z_all.ipk (outils webOS de LG)
python tools/make-android.py    # Android : dist/apl-tv-vX.Y.Z-personal.apk (JDK 17+, SDK Android 35, Gradle 8.10)
```

`tools/check.py` lance les mêmes vérifications que GitHub Actions. `--dev` (et `-Dev` pour Samsung) ajoute un journal de développement servi par l'assistant sur le port 8765, jamais pour l'usage de tous les jours.

Organisation : `app/` est l'app elle-même, la même sur chaque TV (app web ES5) ; `app/js/core.js` reconnaît la TV. `app/service/service.js` est son assistant (la page téléphone, les guides TV compressés, les notes IMDb, les fournisseurs sans CORS) : un service web Tizen sur Samsung, un service JS webOS sur LG (`webos/`), et `Helper.java` dans l'app Android (`android/`), où ExoPlayer lit la vidéo sous la page (`app/js/android.js`). Les fichiers personnels ne sont jamais dans le dépôt : `app/js/keys.local.js`, les polices SF Pro, les sons de l'interface et les clés de signature.

## Ajouter ta playlist

APL TV › Réglages › Playlists › Ajouter une playlist › **Depuis le téléphone** : scanne le QR code avec ton téléphone (sur le même Wi-Fi que la TV), tape ou colle ton lien M3U, ou ton serveur Xtream, ton identifiant et ton mot de passe, et appuie sur Envoyer à l'écran. Tu peux ajouter plusieurs playlists. Un lien M3U qui est en réalité un lien Xtream (`get.php?username=…`) est lu comme Xtream, avec les affiches, les résumés et le guide TV.

## Par l'auteur d'APL Launcher

APL TV est fait par Knikt (Gero Corp.), qui fait aussi **[APL Launcher for Tizen OS](https://github.com/Knikt/APL-Launcher-for-TizenOS)** : un écran d'accueil façon Apple TV pour les TV et Smart Monitors Samsung sous Tizen, avec un Top Shelf vivant pour chaque app, un dock en verre, un Centre de contrôle par-dessus n'importe quelle app, des Réglages et Sources façon Apple TV, des profils pour la famille avec Memoji, et Alexa sur le bouton micro de la télécommande. Son installateur Windows, APL Launcher Setup, met tout sur l'écran en quelques minutes.

Sur Samsung, les deux sont faits pour aller ensemble :

- APL TV a le look du launcher, ses sons d'interface et ses polices.
- Sur l'écran d'accueil du launcher, le Top Shelf d'APL TV montre le film ou l'épisode que tu regardais, à sa minute, et ta dernière chaîne. OK l'ouvre directement.
- APL Launcher Setup installe APL TV d'un seul interrupteur, avec ta clé TMDB, et le garde à jour.

Si APL TV te plaît, jette un œil à APL Launcher, et une étoile sur l'un ou l'autre dépôt fait toujours plaisir.

## Vie privée et sécurité

- Tes playlists et tes comptes restent sur la TV, dans le stockage d'APL TV. Ils ne sont envoyés qu'à ton fournisseur, et jamais écrits dans les journaux.
- APL TV ne parle qu'à ton fournisseur, à TMDB et Cinemeta de Stremio (pour reconnaître les titres), aux fichiers publics d'IMDb (le fichier des notes, une fois par jour), aux sources de guides TV, à OpenSubtitles par le module public de Stremio (seulement quand tu cherches des sous-titres), à GitHub toutes les 6 heures pour chercher une mise à jour (Réglages › Mises à jour le désactive), et, seulement si tu actives la skill Alexa, à ton sujet ntfy.sh privé (les mots cherchés seulement).
- L'assistant sur la TV (port 8765) ne répond qu'à APL TV lui-même, et à la page téléphone pendant qu'un code est affiché. Les sites ouverts dans le navigateur de la TV sont refusés. Le code est aléatoire, change à chaque fois, et trop de mauvais codes le ferment.
- Pas de compte, pas de statistiques, pas de pub.

## Crédits

APL TV est fait par **Knikt** (Gero Corp.)

- Données et images des films et séries : [TMDB](https://www.themoviedb.org). Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
- Notes IMDb par Cinemeta de Stremio et les [fichiers d'IMDb](https://developer.imdb.com/non-commercial-datasets/) (usage personnel et non commercial) ; sous-titres d'[OpenSubtitles](https://www.opensubtitles.org) par le module OpenSubtitles de Stremio.
- Guides TV : le XMLTV de ton fournisseur, [epg.pw](https://epg.pw) et [iptv-epg.org](https://iptv-epg.org).
- Sur Android, la vidéo est lue par [AndroidX Media3 / ExoPlayer](https://github.com/androidx/media) (licence Apache 2.0).
- Le look, les sons et les polices viennent d'APL Launcher.

APL TV n'est affilié ni à Apple, ni à Samsung, LG, Google, Amazon, TMDB, IMDb, OpenSubtitles, Stremio, ni à aucun fournisseur IPTV. Les noms et logos appartiennent à leurs propriétaires.

## Licence

[MIT](LICENSE). Les polices SF Pro et les sons de l'interface ne font pas partie de ce dépôt : APL Launcher Setup copie ceux que tu as.
