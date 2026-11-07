<div align="center">

# APL TV for Tizen OS

**An Apple TV style IPTV player for Samsung Tizen TVs and Smart Monitors.**
Live TV, movies and series from your own M3U playlists and Xtream accounts, in the style of [APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS): tvOS look, Liquid Glass, focus animations and sounds, everything with the remote.

Created by **Knikt** (Gero Corp.), the maker of [APL Launcher](https://github.com/Knikt/APL-Launcher-for-TizenOS)

![APL TV: Home, a title's page, Live TV and the player](docs/images/home.jpg)

[Features](#features) · [Screenshots](#screenshots) · [Requirements](#requirements) · [Install](#install) · [Add your playlist](#add-your-playlist) · [APL Launcher](#from-the-maker-of-apl-launcher) · [Privacy](#privacy-and-security) · [Français](README.fr.md)

</div>

---

> **APL TV is only a player.** It comes with no channels, no playlists and no provider: you add your own. Only use it with content you have the right to watch.

## Features

- **Home, Apple TV style.** A large featured title (backdrop, title logo, age rating, IMDb rating, plot), then Continue Watching, Up Next for your series, Favorite Channels with what's on now, My List, New Movies, New Series, Top Rated and genre rows (anime, K-drama, studios like Ghibli or Pixar, series from Netflix, HBO…).
- **Live TV.** The channel you are on plays full screen behind the interface, with its programme, time left and what comes next. Categories (Favorites, Recent, then yours, your language first), number keys, previous channel, and the 4K / FHD / HD versions of one channel on one card.
- **TV guide** as a grid, from your provider's XMLTV guide (or Xtream's short guide), with epg.pw and iptv-epg.org for channels without one.
- **Multiview:** up to 4 channels at once (how many your screen can decode depends on its chip and your subscription).
- **Movies and series.** Your provider's categories, covers with their IMDb rating, and a page for each title: the real plot in your language (TMDB), seasons and episodes with the ones you watched ticked, the movie's saga, More Like This from your own catalog, the director and the cast, and a page for each actor. Versions of one title (languages, 4K) are grouped together: the one in your language in the best quality your screen shows is picked, and the one you choose is remembered. A Sort button (recently added, A to Z, year, rating).
- **The player.** Subtitles and Audio menus during playback (movies, series and live channels), OpenSubtitles download with a delay adjustment (never chosen by default), subtitle style, precise seeking (10 s steps, faster when you hold), previous and next episode, a next episode card with a picture that spoils nothing, a sleep timer, Picture Size (fit, fill the screen, original shape). Nothing plays by itself unless you turn Autoplay on.
- **Pick up where you left off.** When APL TV opens, it offers the movie or episode you were watching at the minute you stopped, or the last channel.
- **Age ratings in your country's own scale** (France -12 / -16, United States PG-13 / R, Germany FSK 16…), converted from nearby countries when yours has none.
- **Hide what you don't want to see.** Adult categories are hidden by default. In Settings you can hide whole themes (violence, horror, drugs, gore… 20 of them, matched with TMDB's tags and your provider's category names) and single titles: they disappear everywhere, search included. Countries and categories too: Settings > Countries and Categories lists the countries and regions of your playlists, hide a whole one or only some of its categories (or hold OK on a category). Your favorite channels stay.
- **Smart sorting.** The screen's language first (`EU| FR| Sport` is read as French), separators skipped, messy provider names cleaned up.
- **Search** across channels, movies and series with an on-screen keyboard. Accents and case don't matter.
- **Voice, with the screen's Alexa:** "Alexa, pause", play, skip, next episode reach APL TV directly. For searches, which Samsung's Alexa keeps for its own panel, the small [APL TV skill](alexa-skill/) brings them to APL TV: "Alexa, ask APL TV to search Dragon Ball movies" and the results are on screen; "Alexa, ask APL TV to put on M6" and the channel starts. With Bixby, searches should reach APL TV without the skill (not tested yet).
- **Set up from your phone.** The screen shows a QR code; your phone opens a page served by the screen itself on your Wi-Fi (no outside website), protected by a one-time code. The remote works too.
- **APL Launcher integration.** On APL Launcher's Home Screen, APL TV's Top Shelf shows what you were watching and your last channel, and OK opens it right there (APL Launcher 1.0.20 or newer).
- **Automatic updates.** APL TV checks this repository every 6 hours and updates itself (code, look, texts), then restarts when nothing is playing. Your playlists and settings stay. An update that changes the app's permissions asks once for APL Launcher Setup. Settings › Updates.
- English and French (it follows the screen's language).

## Screenshots

| | |
|---|---|
| ![Home](docs/images/home-rows.jpg) **Home:** Continue Watching, Favorite Channels and more rows under the featured title. | ![A title's page](docs/images/title.jpg) **A title's page:** logo, age rating, IMDb, plot, director and cast, More Like This. |
| ![Series](docs/images/series.jpg) **Series:** seasons, episodes with their own pictures and plots, the cast. | ![Movies](docs/images/movies.jpg) **Movies:** your categories and smart genres, IMDb ratings on every cover. |
| ![Live TV](docs/images/live.jpg) **Live TV:** the channel plays behind, what's on now and next. | ![TV guide](docs/images/guide.jpg) **TV guide:** a grid of the next hours, the channel behind. |
| ![Player](docs/images/player.jpg) **The player:** Apple TV style bar, precise seeking, ends at. | ![Subtitles](docs/images/subtitles.jpg) **Subtitles:** the video's tracks, OpenSubtitles, delay and style. |
| ![Search](docs/images/search.jpg) **Search:** channels, movies and series at once, by keyboard or by voice. | ![Overview](docs/images/overview.jpg) **Everything with the remote**, in the look of APL Launcher. |

The screenshots use demo content only: open movies from the Blender Foundation (CC BY) and public domain classics, with made-up channel names. APL TV itself comes with nothing to watch.

## Requirements

- A Samsung Tizen TV or Smart Monitor (Tizen 6 or newer). Tested on a Smart Monitor M8; tell us in an [issue](../../issues) how it runs on yours.
- **No root.** APL TV is an ordinary app: it installs in the screen's Developer Mode, like any app you add with Tizen Studio. Vetro is only used when it is already on your screen, to install without Developer Mode.
- A Samsung certificate for your screen (Tizen Studio's Certificate Manager, or Apps2Samsung): a retail screen only installs apps signed for it.
- Optional but recommended: a free [TMDB API key](https://www.themoviedb.org/settings/api) for posters, plots, cast, age ratings and More Like This. Without one APL TV still plays everything, with your provider's covers.

## Install

### With APL Launcher Setup (recommended)

In [APL Launcher Setup](https://github.com/Knikt/APL-Launcher-for-TizenOS/releases/latest), page Install, turn on **Also install APL TV**. Setup downloads the latest release from here, checks its SHA256, adds your TMDB key and APL Launcher's fonts and sounds, signs it with your certificate and installs it on the screen (through Vetro when it is there, otherwise in Developer Mode). Running the installation again updates APL TV and keeps your playlists.

From the APL Launcher folder, APL TV alone:

```powershell
.\scripts\06-install-apltv.ps1 -TvIp 192.168.1.50 -ProfileName <your signing profile>
```

### By hand, in Developer Mode

Turn on Developer Mode on the screen (Apps, then 1 2 3 4 5 on the remote, Host PC IP = this PC's address), then download `apl-tv-vX.Y.Z.wgt` from [Releases](../../releases/latest). It is signed with the Tizen SDK's default certificate, so sign it again for your screen, then install it, for example with Tizen Studio's CLI:

```powershell
tizen package -t wgt -s <your signing profile> -- apl-tv-vX.Y.Z.wgt
sdb connect <screen address>
tizen install -n apl-tv-vX.Y.Z.wgt -t <your screen>
```

Your TMDB key can then be typed in APL TV: Settings › TMDB Key.

### From the source

Copy `app/js/keys.example.js` to `app/js/keys.local.js` and put your TMDB key in it, then:

```powershell
.\tools\build.ps1 -TizenCli <path to tizen.bat> -Profile <your signing profile> -Install -Ip 192.168.1.50 -Launch
```

`-Install` goes through Vetro when the screen has it, otherwise through Developer Mode (sdb). `-Dev` adds a development log and an in-app test remote served by the helper on port 8765 (never for daily use). `tools/check.py` runs the same checks as GitHub Actions.

Layout: `app/` is the Tizen web app (ES5), `app/service/service.js` its helper service (a Tizen web service: the phone page, compressed TV guides, providers without CORS). Personal files are never in the repository: `app/js/keys.local.js`, the SF Pro fonts and the interface sounds.

## Add your playlist

APL TV › Settings › Playlists › Add a Playlist › **From Your Phone**: scan the QR code with your phone (on the same Wi-Fi as the screen), type or paste your M3U link, or your Xtream server, username and password, and tap Send to the screen. Several playlists can be added. An M3U link that is really an Xtream one (`get.php?username=…`) is read as Xtream, with covers, plots and the TV guide.

## From the maker of APL Launcher

APL TV is made by Knikt (Gero Corp.), who also makes **[APL Launcher for Tizen OS](https://github.com/Knikt/APL-Launcher-for-TizenOS)**: an Apple TV style home screen for Samsung Tizen TVs and Smart Monitors, with a live Top Shelf for every app, a glass dock, a Control Center over any app, Apple TV style Settings and Sources, household profiles with Memoji, and Alexa on the remote's microphone button. Its Windows installer, APL Launcher Setup, puts everything on the screen in a few minutes.

The two are made to go together:

- APL TV has the launcher's look, its interface sounds and its fonts.
- On the launcher's Home Screen, APL TV's Top Shelf shows the movie or episode you were watching at its minute, and your last channel. OK opens it right there.
- APL Launcher Setup installs APL TV with one switch, with your TMDB key, and keeps it up to date.

If you like APL TV, have a look at APL Launcher, and a star on either repository is always appreciated.

## Privacy and security

- Your playlists and accounts stay on the screen, in APL TV's own storage. They are only sent to your provider, and never written in logs.
- APL TV only talks to your provider, to TMDB and Stremio's Cinemeta (to look titles up), to the guide sources, to OpenSubtitles through Stremio's public add-on (only when you look for subtitles), to GitHub every 6 hours to look for an update (Settings › Updates turns it off), and, only if you turn on the Alexa skill, to your private ntfy.sh topic (the searched words only).
- The helper service on the screen (port 8765) only answers APL TV itself, and the phone page while a setup code is shown. Websites opened in the screen's browser are refused. The code is random, changes each time, and too many wrong codes close it.
- No account, no analytics, no ads.

## Credits

APL TV is made by **Knikt** (Gero Corp.)

- Film and series data and pictures: [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
- IMDb ratings through Stremio's Cinemeta; subtitles from [OpenSubtitles](https://www.opensubtitles.org) through Stremio's OpenSubtitles add-on.
- TV guides: your provider's XMLTV, [epg.pw](https://epg.pw) and [iptv-epg.org](https://iptv-epg.org).
- The look, the sounds and the fonts come from APL Launcher.

APL TV is not affiliated with Apple, Samsung, TMDB, OpenSubtitles, Stremio or any IPTV provider. Names and logos belong to their owners.

## License

[MIT](LICENSE). The SF Pro fonts and the interface sounds are not part of this repository: APL Launcher Setup copies the ones you have.
