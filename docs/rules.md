# TarokZa2: uporabljena pravila

Igra sledi slovenskemu taroku v dveh (Napoleon). [Slovenski tarok, »Tarok za dva«](https://slovenski-tarok.si/pravila.html) opisuje delitev in kupčke; [Tarok.net, pravila 1.08, razdelka 2.1–2.2](https://www.tarok.net/pravila108.pdf) določa tudi štetje in razliko za rezultat.

- 54 kart; vsak prejme 15 kart v roko ter tri zaprte kupčke po štiri. Talona ni.
- Nedelilec prvi izbere »Igram« ali »Naprej«. Po njegovem pasu izbira delilec. Dva pasa pomenita navadno igro.
- Šele po licitaciji se odprejo vrhovi kupčkov. Igralec sme vzeti svojega odprtega taroka ali kralja v roko, ni pa dolžan. Karte se nikoli ne prestavijo samodejno.
- Na začetku lahko prevzemata oba igralca; med igro lahko vsak vzame svojega odprtega taroka ali kralja kadarkoli, tudi med nasprotnikovo potezo. Karto sme najprej pustiti na kupčku in jo prevzeti pozneje.
- Vsak prevzem prestavi samo izbrano karto in razkrije naslednjo. Če je tudi ta tarok ali kralj, je zanjo potrebna nova odločitev. Prevzem ni odigrana karta, ne porabi poteze in ne spremeni vodje štiha.
- Po licitaciji se takoj začne igranje. Napovedi kraljev, trule in valata ter potrjevanja »Pripravljen« ni.
- Nedelilec začne prvi štih; naslednjega začne zmagovalec prejšnjega.
- Obvezno slediš barvi, tudi s kupčka; brez barve moraš igrati tarok. Prevzem ni obvezen.
- Karta s kupčka lahko začne štih šele s prazno roko. Po njeni uporabi se odpre naslednja.
- Najvišji tarok pobere; brez taroka pobere najvišja karta izigrane barve.
- Po 27 štihih se zaključi runda. Oba potrdita naslednjo; delilec se zamenja.

## Točke in izrecne izbire različice

Honerji in kralji štejejo 5, dame 4, kavali 3, fantje 2, ostale karte 1. Odštejeta se 2 za vsako trojico, 1 za preostali karti ali karto. Skupaj je 70 točk. Aplikacija hrani tudi natančne tretjine.

Za **osnovno igro** uporabljamo razliko nad 35, kot jo izrecno opredeli Tarok.net. Uspešna napoved (najmanj 36 točk) napovedovalcu prinese dvojno razliko; neuspešna trojno negativno razliko. Nasprotnik pri napovedi za osnovno igro piše 0. V navadni igri zmagovalec piše enojno pozitivno razliko, drugi 0. Primer: 42 : 28 pomeni +14 napovedovalcu; 28 : 42 pomeni −21. Navadnih 42 : 28 pomeni +7 zmagovalcu. Nato se upoštevajo spodnji dogovorjeni dodatki, razen kadar valat nadomesti osnovno igro.

To je izbrani način beleženja, saj vira ne opredelita obeh stolpcev rezultata enako natančno. Pri 35 : 35 je rezultat osnovne igre 0 : 0; napoved ni uspela. Ni zaokroževanja na pet, konter, radelcev ali napovedi ultimo. Neobvezni prevzem odprtih tarokov in kraljev, tudi pozneje, je izrecno potrjena izbira uporabnika za TarokZa2.

### Kralji, trula, valat in mondfang

Dodatki se obračunajo samodejno iz osvojenih štihov, brez napovedovanja.

| Dodatek | Uspeh ob koncu runde | Točke |
| --- | --- | ---: |
| Kralji | Vsi štirje kralji v lastnih štihih | +10 |
| Trula | Pagat, mond in škis v lastnih štihih | +10 |
| Valat | Vseh 27 lastnih štihov | +250 |

- Kralji in trula se obračunajo ločeno za vsakega igralca. Karte morajo biti v osvojenih štihih, ne le v roki.
- Valat nadomesti osnovno igro in dodatke za kralje ter trulo.
- **Mondfang** nastane, ko škis v istem štihu pobere nasprotnikovega monda. Igralec, ki izgubi monda, ob obračunu runde dobi −21. Lovec nima ločenega dodatka +21. Ta osebna kazen se upošteva tudi ob valatu. Dogodek je med igro viden ob roki in ostane shranjen.
- Semafor pri vsaki rundi izpiše osnovno igro, vsak upoštevani dodatek in kazen posebej; njihova vsota za igralca je rezultat runde.

## Strežniški vmesnik

`shared/game.mjs` izvaža `createGame({ playerIds, names, dealer?, rng? })`, `act(game, playerId, action)`, `legalPickups(game, playerId)`, `legalAnnouncements(game, playerId)` in `viewFor(game, playerId)`. `act` spremeni stanje ter ga vrne; prepovedana poteza vrže napako pred spremembo stanja.

Dovoljena dejanja so `{ type: 'bid', bid: 'play' | 'pass' }`, `{ type: 'play', cardId }`, `{ type: 'pickup', cardId }` in `{ type: 'ready' }`. Nova runda teče po fazah `bidding` → `playing` → `roundEnd`.

Pri pošiljanju `play` prek Socket.IO odjemalec doda `expectedPlay: { round, trickNumber, trickSize }` iz prikazanega stanja; `trickSize` je število že odigranih kart v trenutnem štihu (0 ali 1). Strežnik položaj preveri znotraj čakalne vrste mize. Zastarel ali manjkajoč položaj zavrne s kodo `STALE_PLAY` in pošlje trenutno zasebno projekcijo, zato poteza iz drugega zavihka ne more nenamerno začeti naslednjega štiha. Prevzemi položaja ne spremenijo, dovoljenost karte pa se vseeno preveri na aktualnem stanju. Neposredni vmesnik pogona `act` ostaja nespremenjen; shranjenih iger ni treba spreminjati.

`legalPickups` vsebuje samo trenutno odprte lastne taroke in kralje med `playing`, ne glede na potezo. Projekcija vsebuje tudi `scoringVersion`, `legalAnnouncements`, javne `announcements`, `announcementReady`, `preparationTurn` (vedno `null`) in `mondfangs`. Vsaka nova vrstica semaforja vsebuje `breakdown` s postavkami `{ player, kind, points, announced?, success?, trickNumber? }`; vsota postavk za igralca ustreza njegovemu `deltas`.

Stanje je mogoče shraniti kot JSON. Odjemalec prejme samo projekcijo `viewFor`: svojo roko, javne vrhove kupčkov, število skritih kart, potezo, dovoljene izbire, zadnji štih in celoten semafor. Naključno mešanje privzeto uporablja kriptografski generator Node.js. Generator, podan za teste, ni del shranjenega stanja.

Že shranjenih iger ne preurejamo za nazaj: karte, ki jih je prejšnja različica že prestavila v roko, tam ostanejo. Nadaljnji prevzemi zahtevajo izrecno izbiro; nove runde se začnejo s 15 kartami v vsaki roki in nespremenjenimi kupčki. Runde brez oznake `scoringVersion: 2` dokončamo po dosedanjem osnovnem točkovanju, brez naknadnih bonusov in brez vstavljanja faze napovedi sredi igre. Naslednja delitev vključi nova pravila. Že zapisani rezultati in skupne točke se nikoli ne preračunavajo za nazaj.

Ob nalaganju se stara faza `announcements` premakne neposredno v `playing`; začne nedelilec. Karte, prevzemi, rezultati in že oddane napovedi ostanejo ohranjeni. Stare napovedi se še vedno obračunajo po prvotnih vrednostih, novih ni mogoče oddati. `legalAnnouncements` je vedno prazen; dejanji `announce` in `confirmAnnouncements` sta zavrnjeni.

`wonTricks` v zasebni projekciji vsebuje samo pare kart, ki jih je ta igralec osvojil v trenutni rundi, po vrstnem redu osvojitve. Izhaja iz že shranjenih pobranih kart, zato deluje tudi za obstoječe runde brez migracije. Vmesnik »Tvoji štihi« je na voljo med igro in ob rezultatu runde; ogled ne spreminja igre. Seznam se izprazni ob novi delitvi. Oznake »1. osvojeni štih«, »2. osvojeni štih« štejejo igralčeve osvojene štihe, ne vseh štihov runde.
