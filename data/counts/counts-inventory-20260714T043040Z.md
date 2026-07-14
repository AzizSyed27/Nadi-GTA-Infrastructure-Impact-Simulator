# Corridor count inventory — V2.1 Step a (exploratory)

_Contains information licensed under the Open Government Licence – Toronto._

- Generated: 2026-07-14T04:30:40Z  |  bbox (from the canonical net): -79.275788, 43.733164, -79.172419, 43.791787
- **TMC**: [traffic-volumes-at-intersections-for-all-modes](https://open.toronto.ca/dataset/traffic-volumes-at-intersections-for-all-modes/) — resources `tmc_recent`, `tmc_summary`, `tmc_raw_2020s`
- **SVC**: [traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts](https://open.toronto.ca/dataset/traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts/) — resources `svc_recent`, `svc_summary`
- Retrieved: tmc_recent @ 2026-07-14T04:10:14Z, svc_recent @ 2026-07-14T04:10:17Z, tmc_summary @ 2026-07-14T04:10:24Z, svc_summary @ 2026-07-14T04:10:33Z
- Match thresholds: junction 30 m, edge 45 m (distances reported up to 150 m).

Counts are geocoded to the city **centreline**; the net is OSM-derived and was built with `junctions.join`, so consolidated junction centers can sit tens of metres from the centreline point — a 20–40 m lobe in the junction distance histogram is the consolidation signature, not bad data. The SVC summary resources carry **no direction-of-travel field** (verified against the live schema) and the net has no street names, so midblock volumes attach to the directed edge **pair** (`direction_resolution: pair`) — never silently to one direction — with a capacity plausibility flag as the wrong-street insurance.

## TMC intersections in-corridor (324; matched 269, AM-peak-supported 126)

| location | latest count | recency | modes | dur (h) | junction | dist (m) | matched | AM 07–09 covered? |
|---|---|---|---|---|---|---|---|---|
| Chandler Dr / Janray Dr (South) | 2020-11-11 | recent | vehicle/bike/ped | 8R | 427760309 | 1.6 | yes | partial (6/8 slots) |
| Brockley Dr / Treewood St | 2021-10-06 | recent | vehicle/bike/ped | 8R | 427653583 | 0.9 | yes | partial (6/8 slots) |
| McCowan Rd / Huronia Gt | 2021-12-14 | recent | vehicle/bike/ped | 8R | 278364235 | 2.4 | yes | partial (6/8 slots) |
| Benshire Dr / Bellechasse St | 2021-12-14 | recent | vehicle/bike/ped | 8R | 427659701 | 1.4 | yes | partial (6/8 slots) |
| Doerr Rd / Bernadine St | 2021-12-14 | recent | vehicle/ped | 8R | 427654045 | 1.8 | yes | partial (6/8 slots) |
| Neilson Rd / Oakmeadow Blvd | 2022-01-27 | recent | vehicle/ped | 8R | 32348014 | 4.6 | yes | partial (6/8 slots) |
| Manse Rd / Coronation Dr (North) | 2022-02-01 | recent | vehicle/bike/ped | 8R | 44255241 | 8.3 | yes | partial (6/8 slots) |
| Kingston Rd / Galloway Rd | 2022-02-01 | recent | vehicle/bike/ped | 8R | cluster_33511448_33511449 | 2.2 | yes | partial (6/8 slots) |
| Morningside Ave / Warnsworth St | 2022-02-01 | recent | vehicle/bike/ped | 8S | 287775468 | 3.0 | yes | partial (6/8 slots) |
| Par Ave / Golfhaven Dr | 2022-02-15 | recent | vehicle/ped | 8R | 427759442 | 1.1 | yes | partial (6/8 slots) |
| Progress Ave / Grangeway Ave / Consilium Pl | 2022-02-23 | recent | vehicle/bike/ped | 8R | cluster_32475791_648913569 | 4.1 | yes | partial (6/8 slots) |
| Progress Ave / Schick Crt | 2022-02-23 | recent | vehicle/bike/ped | 8R | 32472826 | 2.1 | yes | partial (6/8 slots) |
| Markham Rd / Pandora Crcl | 2022-03-08 | recent | vehicle/bike/ped | 8R | 281310798 | 1.4 | yes | partial (6/8 slots) |
| Milner Ave / Novopharm Crt | 2022-03-08 | recent | vehicle/bike/ped | 8S | 414466528 | 2.1 | yes | partial (6/8 slots) |
| Bellamy Rd N / Bridlington St | 2022-03-29 | recent | vehicle/bike/ped | 8S | 427657332 | 1.8 | yes | partial (6/8 slots) |
| Bellamy Rd N / Brimorton Dr | 2022-04-05 | recent | vehicle/bike/ped | 8R | 272056735 | 2.9 | yes | partial (6/8 slots) |
| Dearham Wood / Schubert Dr | 2022-04-19 | recent | vehicle/bike/ped | 8R | 428550023 | 1.3 | yes | partial (6/8 slots) |
| Markham Rd / Brimorton Dr | 2022-04-19 | recent | vehicle/ped | 8R | 252423218 | 3.8 | yes | partial (6/8 slots) |
| Conlins Rd / Military Trl / Lash Crt | 2022-04-19 | recent | vehicle/bike/ped | 8R | 428478917 | 1.4 | yes | partial (6/8 slots) |
| McCowan Rd / West Highland Creek Trl (South) | 2022-06-15 | recent | vehicle/bike/ped | 8R | 1186350689 | 13.0 | yes | partial (6/8 slots) |
| Par Ave / Mossbank Dr | 2022-06-29 | recent | vehicle/bike/ped | 8R | 427760744 | 1.7 | yes | partial (6/8 slots) |
| Beran Dr / Confederation Dr | 2022-08-30 | recent | vehicle/bike/ped | 8R | 427757692 | 1.2 | yes | partial (6/8 slots) |
| Confederation Dr / Palacky St | 2022-08-30 | recent | vehicle/bike/ped | 8R | 427757701 | 0.9 | yes | partial (6/8 slots) |
| Netheravon Rd / Pegasus Trl | 2022-09-27 | recent | vehicle/bike/ped | 8R | 427760067 | 1.9 | yes | partial (6/8 slots) |
| Farmbrook Rd / Cheyenne Dr | 2022-09-29 | recent | vehicle/bike/ped | 8S | 418980441 | 0.8 | yes | partial (6/8 slots) |
| Orton Park Rd / Botany Hill Rd / Slan Ave | 2022-09-29 | recent | vehicle/bike/ped | 8R | 427759991 | 1.1 | yes | partial (6/8 slots) |
| Chandler Dr / Janray Dr (North) | 2022-09-29 | recent | vehicle/bike/ped | 8R | 427756687 | 0.8 | yes | partial (6/8 slots) |
| Savarin St | 2022-09-29 | recent | vehicle/bike/ped | 8R | 9120311737 | 16.8 | yes | partial (6/8 slots) |
| Poplar Rd / Cultra Sq / Gardentree St | 2022-10-20 | recent | vehicle/bike/ped | 8S | 241355525 | 1.8 | yes | partial (6/8 slots) |
| Prince Philip Blvd / Sylvan Ave | 2022-10-20 | recent | vehicle/bike/ped | 8R | 413716795 | 1.6 | yes | partial (6/8 slots) |
| Rowatson Rd / Guildwood Pkwy | 2022-10-20 | recent | vehicle/bike/ped | 8S | cluster_277153879_277153953 | 2.2 | yes | partial (6/8 slots) |
| Kingston Rd / Brinloor Blvd | 2022-11-05 | recent | vehicle/bike/ped | 8R | cluster_379872394_379872399 | 2.3 | yes | partial (6/8 slots) |
| Morna Ave / Cumber Ave | 2022-11-23 | recent | vehicle/bike/ped | 8R | 428549992 | 1.0 | yes | partial (6/8 slots) |
| Beran Dr / Palacky St | 2022-11-23 | recent | vehicle/ped | 8R | 427761440 | 1.1 | yes | partial (6/8 slots) |
| Havenway Gt / Waldock St | 2022-11-23 | recent | vehicle/bike/ped | 8S | 428550552 | 2.2 | yes | partial (6/8 slots) |
| Prince Philip Blvd / Guildwood Pkwy / Rosa And Spencer Clark Parkette Trl | 2022-11-23 | recent | vehicle/bike/ped | 8R | cluster_33512754_418525606 | 3.0 | yes | partial (6/8 slots) |
| Saunders Rd / Dale Ave | 2022-11-23 | recent | vehicle/bike/ped | 8R | 418980132 | 1.7 | yes | partial (6/8 slots) |
| Military Trl / Pan Am Dr | 2022-12-17 | recent | vehicle/bike/ped | 8R | 1904772888 | 4.3 | yes | partial (6/8 slots) |
| Ellesmere Rd / Conlins Rd | 2022-12-17 | recent | vehicle/bike/ped | 8R | cluster_428477339_428477654 | 1.7 | yes | partial (6/8 slots) |
| Ellesmere Rd / Military Trl | 2022-12-17 | recent | vehicle/bike/ped | 8R | 32376754 | 3.2 | yes | partial (6/8 slots) |
| Ellesmere Rd / Dormington Dr / Gander Dr | 2022-12-17 | recent | vehicle/bike/ped | 8R | 258016546 | 1.1 | yes | partial (6/8 slots) |
| Ellesmere Rd / Markham Rd | 2022-12-17 | recent | vehicle/ped | 8R | cluster_258016993_258016994_38125022_38125034 | 3.2 | yes | partial (6/8 slots) |
| Ellesmere Rd / Dolly Varden Blvd | 2022-12-17 | recent | vehicle/bike/ped | 8R | 278364902 | 1.3 | yes | partial (6/8 slots) |
| Ellesmere Rd / Parkington Cres | 2022-12-17 | recent | vehicle/bike/ped | 8R | 278364582 | 0.9 | yes | partial (6/8 slots) |
| Ellesmere Rd / Bellamy Rd N | 2022-12-17 | recent | vehicle/bike/ped | 8R | cluster_13722307717_13722307718_13722307719_13722307720 | 1.7 | yes | partial (6/8 slots) |
| Ellesmere Rd / Grangeway Ave | 2022-12-17 | recent | vehicle/bike/ped | 8R | 1738814629 | 2.7 | yes | partial (6/8 slots) |
| Ellesmere Rd / Borough Approach E | 2022-12-17 | recent | vehicle/ped | 8R | cluster_297561872_427685520 | 11.2 | yes | partial (6/8 slots) |
| Ellesmere Rd / Birkdale Rd | 2022-12-17 | recent | vehicle/bike/ped | 8R | cluster_272056124_4455068107 | 3.3 | yes | partial (6/8 slots) |
| McCowan Rd / Lawrence Ave E | 2023-02-09 | recent | vehicle/ped | 8R | cluster_32378586_4372627497_4372627498_4372627502 | 2.8 | yes | partial (6/8 slots) |
| Galloway Rd / Coronation Dr | 2023-02-28 | recent | vehicle/ped | 8R | 428550570 | 1.9 | yes | partial (6/8 slots) |
| Poplar Rd / Coronation Dr (South) | 2023-02-28 | recent | vehicle/bike/ped | 8R | cluster_13657447047_277490441_44269883 | 10.9 | yes | partial (6/8 slots) |
| Kingston Rd / Orchard Park Dr | 2023-03-29 | recent | vehicle/bike/ped | 8R | 41180598 | 7.7 | yes | partial (6/8 slots) |
| Kingston Rd / West Hill Dr | 2023-03-29 | recent | vehicle/bike/ped | 8R | cluster_41180498_41180526 | 0.8 | yes | partial (6/8 slots) |
| Danforth Rd / McCowan Rd / Perivale Cres | 2023-04-18 | recent | vehicle/bike/ped | 8R | 278359879 | 4.4 | yes | partial (6/8 slots) |
| Summerbridge Rd / Marcella St | 2023-06-01 | recent | vehicle/bike/ped | 8S | 427756689 | 2.6 | yes | partial (6/8 slots) |
| Kingston Rd / Manse Rd | 2023-06-01 | recent | vehicle/bike/ped | 8S | 33539435 | 8.9 | yes | partial (6/8 slots) |
| Van Allan Rd / Stevenvale Dr | 2023-06-15 | recent | vehicle/bike/ped | 8S | 427761002 | 2.5 | yes | partial (6/8 slots) |
| Ellesmere Rd / Scarborough Golf Club Rd / Helicon Gt | 2023-06-29 | recent | vehicle/bike/ped | 8R | cluster_427756639_427761116 | 0.6 | yes | partial (6/8 slots) |
| Scarborough Golf Club Rd / Brimorton Dr | 2023-06-29 | recent | vehicle/bike/ped | 8R | 427760366 | 0.6 | yes | partial (6/8 slots) |
| Scarborough Golf Club Rd / Bankwell Ave / Slan Ave | 2023-07-05 | recent | vehicle/bike/ped | 8R | 427758288 | 1.4 | yes | partial (6/8 slots) |
| Scarborough Golf Club Rd / Newark Rd | 2023-07-18 | recent | vehicle/bike/ped | 8R | 427760532 | 1.6 | yes | partial (6/8 slots) |
| Brimley Rd / Britwell Ave | 2023-07-18 | recent | vehicle/bike/ped | 8R | 272059704 | 0.5 | yes | partial (6/8 slots) |
| Cedar Brae Blvd / Bellamy Rd N / Trudelle St | 2023-07-18 | recent | vehicle/bike/ped | 8R | 418523342 | 2.7 | yes | partial (6/8 slots) |
| Lawrence Ave E / Brockley Dr | 2023-09-19 | recent | vehicle/bike/ped | 14 | cluster_134189341_8279525552 | 0.8 | yes | YES (2023-09-19) |
| Brimley Rd / Citadel Dr | 2023-10-12 | recent | vehicle/bike/ped | 14 | 127757162 | 1.1 | yes | YES (2023-10-12) |
| Kingston Rd / Collinsgrove Rd | 2023-10-14 | recent | vehicle/bike/ped | 14 | cluster_5467979726_5467979727 | 1.2 | yes | YES (2023-10-14) |
| Highcastle Rd / Oakmeadow Blvd (South) | 2023-10-17 | recent | vehicle/bike/ped | 14 | 428587898 | 1.0 | yes | YES (2023-10-17) |
| Markham Rd / Progress Ave | 2023-11-30 | recent | vehicle/bike/ped | 8R | cluster_433752029_433752047_433752052_433752056 | 5.3 | yes | partial (6/8 slots) |
| McCowan Rd S Progress Ave Ramp / Progress Ave | 2023-11-30 | recent | vehicle/bike/ped | 8R | cluster_32472344_648913728 | 6.0 | yes | partial (6/8 slots) |
| Progress Ave / Bellamy Rd N / Corporate Dr | 2023-11-30 | recent | vehicle/bike/ped | 8R | 134209625 | 4.2 | yes | partial (6/8 slots) |
| Milner Ave / Progress Ave | 2023-11-30 | recent | vehicle/bike/ped | 8R | 32473289 | 7.1 | yes | partial (6/8 slots) |
| Hwy 401 Collectors E Progress Ave Ramp / Progress Ave | 2023-12-05 | recent | vehicle/bike/ped | 8R | cluster_648905342_648955085 | 0.7 | yes | partial (6/8 slots) |
| Brimorton Dr / Painted Post Dr | 2023-12-06 | recent | vehicle/bike/ped | 14 | 427756564 | 1.2 | yes | YES (2023-12-06) |
| Morningside Ave / Danzig St | 2023-12-10 | recent | vehicle/bike/ped | 8R | 59823455 | 2.2 | yes | partial (6/8 slots) |
| Morningside Ave / Military Trl | 2023-12-10 | recent | vehicle/bike/ped | 8R | cluster_11263480098_12725939473_12725939476_1463386510_#3more | 20.6 | yes | partial (6/8 slots) |
| Morningside Ave / Coronation Dr | 2023-12-10 | recent | vehicle/bike/ped | 8R | 138603787 | 0.8 | yes | partial (6/8 slots) |
| Morningside Ave / Tefft Rd | 2023-12-10 | recent | vehicle/bike/ped | 8R | 41182222 | 2.7 | yes | partial (6/8 slots) |
| Triton Rd / Borough Dr | 2024-01-17 | recent | vehicle/bike/ped | 8R | cluster_297561967_297561969_297562014_297562018 | 4.1 | yes | partial (6/8 slots) |
| Ellesmere Rd / Orton Park Rd / Military Trl / Hydro Corridor | 2024-02-28 | recent | vehicle/bike/ped | 14 | 59834332 | 1.3 | yes | YES (2024-02-28) |
| Orton Park Rd / Thornbeck Dr | 2024-03-06 | recent | vehicle/bike/ped | 14 | 427761433 | 1.6 | yes | YES (2024-03-06) |
| Midland Ave / Lord Roberts Dr | 2024-03-06 | recent | vehicle/bike/ped | 14 | 245027598 | 2.4 | yes | YES (2024-03-06) |
| Markham Rd / Lawrence Ave E | 2024-03-26 | recent | vehicle/bike/ped | 14 | cluster_427773214_427773222_427773228_427773233 | 2.2 | yes | YES (2024-03-26) |
| Lee Centre Dr / Corporate Dr / Lee Centre Park Trl | 2024-04-21 | recent | vehicle/bike/ped | 14 | 306312329 | 1.5 | yes | YES (2024-04-21) |
| Corporate Dr / Hwy 401 Collectors E Ramp | 2024-04-21 | recent | vehicle/bike/ped | 14 | cluster_32474412_648917567 | 2.7 | yes | YES (2024-04-21) |
| Progress Ave / Corporate Dr | 2024-04-21 | recent | vehicle/bike/ped | 14 | cluster_414467162_414468957 | 1.6 | yes | YES (2024-04-21) |
| McCowan Rd / Brimorton Dr | 2024-06-11 | recent | vehicle/bike/ped | 14 | 427658932 | 1.4 | yes | YES (2024-06-11) |
| Markham Rd / Milner Ave | 2024-06-13 | recent | vehicle/bike/ped | 14 | cluster_257892052_257892053_65238151_65238305 | 4.1 | yes | YES (2024-06-13) |
| Kingston Rd / Cromwell Rd / Guildwood Pkwy | 2024-06-19 | recent | vehicle/bike/ped | 14 | cluster_32412880_33513422_33513448 | 0.8 | yes | YES (2024-06-19) |
| Markham Rd / Greencedar Crct / Greencrest Crct | 2024-07-03 | recent | vehicle/bike/ped | 14 | cluster_427758711_427773231 | 2.6 | yes | YES (2024-07-03) |
| Markham Rd / Greenbrae Crct / Greenholm Crct | 2024-07-03 | recent | vehicle/bike/ped | 14 | 143985919 | 4.7 | yes | YES (2024-07-03) |
| Markham Rd / Tuxedo Crt | 2024-09-11 | recent | vehicle/bike/ped | 14 | cluster_292958354_8713098229 | 2.6 | yes | YES (2024-09-11) |
| Livingston Rd / Guildwood Pkwy | 2024-10-08 | recent | vehicle/bike/ped | 14 | cluster_33512745_33512850 | 2.5 | yes | YES (2024-10-08) |
| McCowan Rd / Pitfield Rd / Invergordon Ave | 2024-10-16 | recent | vehicle/bike/ped | 14 | cluster_429374811_429374827 | 1.3 | yes | YES (2024-10-16) |
| McCowan Rd / Milner Ave / Channel Nine Crt | 2024-10-16 | recent | vehicle/bike/ped | 14 | cluster_356949804_429374545 | 1.2 | yes | YES (2024-10-16) |
| Eglinton Ave E / McCowan Rd | 2024-10-19 | recent | vehicle/bike/ped | 14 | 241327103 | 4.5 | yes | YES (2024-10-19) |
| Markham Rd / Eglinton Ave E | 2024-10-19 | recent | vehicle/bike/ped | 14 | cluster_433591041_433591047_433591049_433591050 | 0.7 | yes | YES (2024-10-19) |
| Kingston Rd / Lawrence Ave E | 2024-10-22 | recent | vehicle/bike/ped | 14 | cluster_427825255_427825257_427825263_427825264 | 4.4 | yes | YES (2024-10-22) |
| Lawrence Ave E / Galloway Rd | 2024-10-22 | recent | vehicle/bike/ped | 14 | cluster_427820922_427820923 | 1.7 | yes | YES (2024-10-22) |
| Lawrence Ave E / Greenholm Crct / Greencrest Crct | 2024-10-22 | recent | vehicle/bike/ped | 14 | 59834168 | 0.9 | yes | YES (2024-10-22) |
| Lawrence Ave E / Scarborough Golf Club Rd | 2024-10-22 | recent | vehicle/bike/ped | 14 | cluster_427756971_427760272_427760649_427761298 | 2.0 | yes | YES (2024-10-22) |
| Lawrence Ave E / Barrymore Rd | 2024-10-22 | recent | vehicle/bike/ped | 14 | 427731061 | 1.9 | yes | YES (2024-10-22) |
| Lawrence Ave E / Greenbrae Crct / Greencedar Crct | 2024-10-22 | recent | vehicle/bike/ped | 14 | 134219967 | 2.0 | yes | YES (2024-10-22) |
| Lawrence Ave E / Morningside Ave | 2024-10-22 | recent | vehicle/bike/ped | 14 | cluster_427826636_427826638_427826642_427826650 | 2.4 | yes | YES (2024-10-22) |
| Collinsgrove Rd / Ling Rd / Lawrence Ave E | 2024-10-22 | recent | vehicle/bike/ped | 14 | 32346406 | 1.3 | yes | YES (2024-10-22) |
| Consilium Pl / Corporate Dr | 2024-10-29 | recent | vehicle/bike/ped | 14 | cluster_1367253549_1367253551_1367253558_1367253561 | 1.6 | yes | YES (2024-10-29) |
| McCowan Rd / Bushby Dr / Town Centre Crt | 2024-10-29 | recent | vehicle/bike/ped | 14 | cluster_32476072_648921963_648921972_648921974 | 3.0 | yes | YES (2024-10-29) |
| Sheppard Ave E / Brownspring Rd | 2024-10-30 | recent | vehicle/bike/ped | 14 | 258019366 | 2.3 | yes | YES (2024-10-30) |
| Brimley Rd / Pitfield Rd | 2024-11-02 | recent | vehicle/bike/ped | 14 | 258017384 | 0.7 | yes | YES (2024-11-02) |
| Brimley Rd / Heather Rd | 2024-11-02 | recent | vehicle/bike/ped | 14 | 268735945 | 1.5 | yes | YES (2024-11-02) |
| Brimley Rd / Sheppard Ave E | 2024-11-02 | recent | vehicle/bike/ped | 14 | cluster_764519750_764519772_764519774_764519776 | 1.9 | yes | YES (2024-11-02) |
| Danforth Rd / Trudelle St | 2024-11-02 | recent | vehicle/bike/ped | 14 | 418523271 | 1.2 | yes | YES (2024-11-02) |
| Danforth Rd / Savarin St | 2024-11-02 | recent | vehicle/bike/ped | 14 | 32496583 | 1.2 | yes | YES (2024-11-02) |
| Danforth Rd / Seminole Ave | 2024-11-02 | recent | vehicle/bike/ped | 14 | 418980085 | 0.6 | yes | YES (2024-11-02) |
| Danforth Rd / Barrymore Rd | 2024-11-02 | recent | vehicle/bike/ped | 14 | 266901178 | 0.8 | yes | YES (2024-11-02) |
| Brimley Rd / Omni Dr / Golden Gate Crt | 2024-11-02 | recent | vehicle/bike/ped | 14 | 266292947 | 1.6 | yes | YES (2024-11-02) |
| Brimley Rd / Applefield Dr / Bernadine St | 2024-11-02 | recent | vehicle/bike/ped | 14 | 32474180 | 3.5 | yes | YES (2024-11-02) |
| Brimley Rd / Waterfield Dr / Brimorton Dr | 2024-11-02 | recent | vehicle/bike/ped | 14 | 272056708 | 1.3 | yes | YES (2024-11-02) |
| Brimley Rd / St Andrews Rd / Applefield Dr | 2024-11-02 | recent | vehicle/bike/ped | 14 | 32474182 | 2.1 | yes | YES (2024-11-02) |
| Brimley Rd / Dorcot Ave / Thomson Memorial Park Trl | 2024-11-02 | recent | vehicle/bike/ped | 14 | 266298287 | 1.7 | yes | YES (2024-11-02) |
| Brimley Rd / Shediac Rd / Fraserton Gt | 2024-11-02 | recent | vehicle/bike/ped | 14 | 59360644 | 2.5 | yes | YES (2024-11-02) |
| Brimley Rd / Deerfield Rd | 2024-11-02 | recent | vehicle/bike/ped | 14 | 418979773 | 1.1 | yes | YES (2024-11-02) |
| Brimley Rd / Chillery Ave | 2024-11-02 | recent | vehicle/bike/ped | 14 | 127757334 | 1.4 | yes | YES (2024-11-02) |
| Hwy 401 Collectors W Mccowan Rd Ramp / Hwy 401 Collectors W Ramp / McCowan Rd / Mccowan Rd S | 2024-11-12 | recent | vehicle/bike/ped | 14 | cluster_32474466_32474467 | 0.8 | yes | YES (2024-11-12) |
| Kitchener Rd / Danzig St | 2024-11-12 | recent | vehicle/bike/ped | 14 | 277490558 | 0.5 | yes | YES (2024-11-12) |
| Marlena Dr / Danzig St | 2024-11-12 | recent | vehicle/bike/ped | 14 | 277490561 | 0.6 | yes | YES (2024-11-12) |
| Consilium Pl / Hwy 401 Collectors E Mccowan Rd Ramp / McCowan Rd | 2024-11-13 | recent | vehicle/bike/ped | 14 | cluster_32472336_648921944 | 3.5 | yes | YES (2024-11-13) |
| Gloaming Dr / Danzig St | 2024-11-14 | recent | vehicle/bike/ped | 14 | 277490895 | 0.7 | yes | YES (2024-11-14) |
| Dubarry Ave / Darlingside Dr | 2024-11-19 | recent | vehicle/bike/ped | 14 | 276550196 | 0.5 | yes | YES (2024-11-19) |
| Midland Ave / Stansbury Cres | 2024-11-23 | recent | vehicle/bike/ped | 14 | 418514407 | 1.7 | yes | YES (2024-11-23) |
| Midland Ave / Dorcot Ave | 2024-11-23 | recent | vehicle/bike/ped | 14 | 266298477 | 2.1 | yes | YES (2024-11-23) |
| Midland Ave / Brockley Dr | 2024-11-23 | recent | vehicle/bike/ped | 14 | 11591354578 | 3.0 | yes | YES (2024-11-23) |
| Midland Ave / Prudential Dr | 2024-11-23 | recent | vehicle/bike/ped | 14 | cluster_134185914_7450278104 | 2.4 | yes | YES (2024-11-23) |
| Midland Ave / Marcos Blvd / Romulus Dr | 2024-11-23 | recent | vehicle/bike/ped | 14 | 127755975 | 1.6 | yes | YES (2024-11-23) |
| Bellamy Rd N / Painted Post Dr | 2024-12-11 | recent | vehicle/bike/ped | 14 | 427659012 | 1.2 | yes | YES (2024-12-11) |
| Midland Ave / Millbridge Gt | 2024-12-18 | recent | vehicle/bike/ped | 14 | 272059697 | 2.5 | yes | YES (2024-12-18) |
| Brimley Rd / Elgar Ave / Dallyn Cres | 2024-12-18 | recent | vehicle/bike/ped | 14 | 258022227 | 0.8 | yes | YES (2024-12-18) |
| Ellesmere Rd / Saratoga Dr | 2024-12-18 | recent | vehicle/bike/ped | 14 | cluster_276486026_427653445 | 3.8 | yes | YES (2024-12-18) |
| Janray Dr / Fortune Gt | 2025-01-28 | recent | vehicle/ped | 14 | 427757443 | 1.5 | yes | YES (2025-01-28) |
| Amberjack Blvd / Brimorton Dr | 2025-03-19 | recent | vehicle/bike/ped | 14 | 427658354 | 4.8 | yes | YES (2025-03-19) |
| Lawrence Ave E / Valparaiso Ave | 2025-05-21 | recent | vehicle/bike/ped | 14 | 427728885 | 3.0 | yes | YES (2025-05-21) |
| Lawrence Ave E / Burnview Cres | 2025-05-21 | recent | vehicle/bike/ped | 14 | 1430604103 | 0.6 | yes | YES (2025-05-21) |
| Lawrence Ave E / Bellamy Rd N | 2025-05-21 | recent | vehicle/bike/ped | 14 | cluster_544177060_544177062_544177064_544177065 | 1.3 | yes | YES (2025-05-21) |
| Manse Rd / Lawrence Ave E | 2025-05-21 | recent | vehicle/bike/ped | 14 | 33539443 | 3.1 | yes | YES (2025-05-21) |
| Bellamy Rd N / Amarillo Dr | 2025-05-28 | recent | vehicle/bike/ped | 14 | 418523858 | 1.4 | yes | YES (2025-05-28) |
| Adanac Dr / Bellamy Rd S / McCowan District Park Trl | 2025-05-28 | recent | vehicle/bike/ped | 14 | 418523721 | 2.0 | yes | YES (2025-05-28) |
| Mason Rd / Adanac Dr | 2025-05-28 | recent | vehicle/bike/ped | 14 | 241338706 | 1.5 | yes | YES (2025-05-28) |
| Cedar Brae Blvd / Banmoor Blvd / Bellamy Rd N | 2025-05-28 | recent | vehicle/bike/ped | 14 | 266261971 | 1.5 | yes | YES (2025-05-28) |
| Ellesmere Rd / McCowan Rd | 2025-06-25 | recent | vehicle/bike/ped | 14 | cluster_13722263967_13722263968_13722263969_13722263970 | 3.3 | yes | YES (2025-06-25) |
| Ellesmere Rd / Brimley Rd | 2025-06-25 | recent | vehicle/bike/ped | 14 | cluster_13722262591_13722262592_13722262593_13722262594 | 2.8 | yes | YES (2025-06-25) |
| Ellesmere Rd / Borough Approach W | 2025-06-25 | recent | vehicle/bike/ped | 14 | cluster_297561822_427685525_427685527 | 14.7 | yes | YES (2025-06-25) |
| Lawrence Ave E / Midland Ave | 2025-07-03 | recent | vehicle/bike/ped | 14 | cluster_414411286_414457402_469627192_469627202 | 0.8 | yes | YES (2025-07-03) |
| Kingston Rd / Morningside Ave | 2025-07-03 | recent | vehicle/bike/ped | 14 | cluster_428559727_428559729_428559734_428559740 | 1.8 | yes | YES (2025-07-03) |
| Brimley Rd / Lawrence Ave E / Gatineau Hydro Corridor Trl | 2025-07-03 | recent | vehicle/bike/ped | 14 | 32474189 | 1.6 | yes | YES (2025-07-03) |
| Brimley Rd / Triton Rd | 2025-07-03 | recent | vehicle/bike/ped | 14 | cluster_297565688_297565703 | 4.4 | yes | YES (2025-07-03) |
| Ellesmere Rd / Morningside Ave | 2025-07-03 | recent | vehicle/bike/ped | 14 | 32346645 | 1.2 | yes | YES (2025-07-03) |
| Milner Ave / Mid-Dominion Acres / Executive Crt | 2025-08-06 | recent | vehicle/bike/ped | 14 | 257892178 | 1.8 | yes | YES (2025-08-06) |
| Dearham Wood / Toynbee Trl | 2025-08-26 | recent | vehicle/bike/ped | 14 | 277156095 | 0.4 | yes | YES (2025-08-26) |
| Morningside Ave / Pixley Cres / Gardentree St | 2025-08-27 | recent | vehicle/bike/ped | 14 | 428550609 | 0.7 | yes | YES (2025-08-27) |
| Poplar Rd / Waldock St | 2025-09-30 | recent | vehicle/bike/ped | 14 | 277490664 | 2.0 | yes | YES (2025-09-30) |
| Markham Rd / Rochman Blvd | 2025-10-07 | recent | vehicle/bike/ped | 14 | 427659366 | 3.5 | yes | YES (2025-10-07) |
| Neilson Rd / Military Trl | 2025-10-16 | recent | vehicle/bike/ped | 14 | 32376758 | 3.7 | yes | YES (2025-10-16) |
| McCowan Rd / Sheppard Ave E | 2025-10-19 | recent | vehicle/bike/ped | 14 | cluster_429374813_429374814_429374818_429374823 | 1.4 | yes | YES (2025-10-19) |
| Lochleven Dr / Knowlton Dr / Coltbridge Crt | 2025-10-21 | recent | vehicle/bike/ped | 14 | 418523575 | 0.9 | yes | YES (2025-10-21) |
| Neilson Rd / Keeler Blvd / Oakmeadow Blvd | 2025-10-26 | recent | vehicle/bike/ped | 14 | 293051697 | 4.2 | yes | YES (2025-10-26) |
| Neilson Rd / Livonia Pl / Purpledusk Trl | 2025-10-26 | recent | vehicle/bike/ped | 14 | 32348006 | 3.8 | yes | YES (2025-10-26) |
| Ellesmere Rd / Neilson Rd | 2025-10-26 | recent | vehicle/bike/ped | 14 | cluster_427761610_428591834 | 1.4 | yes | YES (2025-10-26) |
| Bellamy Rd N / Porchester Dr | 2025-11-11 | recent | vehicle/bike/ped | 14 | 266261662 | 1.5 | yes | YES (2025-11-11) |
| McCowan Rd / Trudelle St | 2025-11-22 | recent | vehicle/bike/ped | 14 | 266261617 | 1.9 | yes | YES (2025-11-22) |
| Kingston Rd / Eglinton Ave E | 2025-11-22 | recent | vehicle/bike/ped | 14 | cluster_32458166_32458168_433592702 | 5.6 | yes | YES (2025-11-22) |
| Eglinton Ave E / Cedar Dr | 2025-11-22 | recent | vehicle/bike/ped | 14 | cluster_241343614_433592698 | 2.6 | yes | YES (2025-11-22) |
| Eglinton Ave E / Beachell St | 2025-11-22 | recent | vehicle/bike/ped | 14 | 241342332 | 1.1 | yes | YES (2025-11-22) |
| Eglinton Ave E / Mason Rd | 2025-11-22 | recent | vehicle/bike/ped | 14 | cluster_3524717298_3524717300_433591055_433591057_#1more | 19.0 | yes | YES (2025-11-22) |
| Eglinton Ave E / Bellamy Rd N | 2025-11-22 | recent | vehicle/bike/ped | 14 | cluster_13284225813_13284225814_433591082_433591083 | 1.1 | yes | YES (2025-11-22) |
| Eglinton Ave E / Torrance Rd | 2025-11-22 | recent | vehicle/bike/ped | 14 | 11224161610 | 17.8 | yes | YES (2025-11-22) |
| Kingston Rd / Scarborough Golf Club Rd | 2025-11-22 | recent | vehicle/bike/ped | 14 | cluster_137437710_137437716 | 2.1 | yes | YES (2025-11-22) |
| Markham Rd / Markanna Dr | 2025-11-22 | recent | vehicle/bike/ped | 14 | 266264574 | 0.9 | yes | YES (2025-11-22) |
| Markham Rd / Luella St | 2025-11-22 | recent | vehicle/bike/ped | 14 | 266262552 | 6.4 | yes | YES (2025-11-22) |
| Bellamy Rd N / Nelson St | 2025-11-22 | recent | vehicle/bike/ped | 14 | 418980459 | 2.2 | yes | YES (2025-11-22) |
| Borough Dr / Town Centre Crt (North) | 2025-12-11 | recent | vehicle/bike/ped | 14 | 32476071 | 3.7 | yes | YES (2025-12-11) |
| Kingston Rd / Amiens Rd | 2026-01-22 | recent | vehicle/bike/ped | 14 | cluster_5467979724_5467979725 | 0.9 | yes | YES (2026-01-22) |
| Borough Dr / Omni Dr | 2026-01-29 | recent | vehicle/bike/ped | 14 | cluster_297561913_297561952_32476101_32476102_#1more | 1.1 | yes | YES (2026-01-29) |
| Kingston Rd / Falaise Rd | 2026-01-29 | recent | vehicle/bike/ped | 14 | cluster_32414945_428554462 | 8.5 | yes | YES (2026-01-29) |
| Borough Dr / Town Centre Crt (South) | 2026-01-29 | recent | vehicle/bike/ped | 14 | cluster_32476043_32476081 | 1.8 | yes | YES (2026-01-29) |
| Ellesmere Rd / Mornelle Crt | 2026-02-04 | recent | vehicle/bike/ped | 14 | 296403598 | 4.4 | yes | YES (2026-02-04) |
| Bakerton Dr / Porchester Dr | 2026-02-19 | recent | vehicle/ped | 14 | 418980412 | 0.7 | yes | YES (2026-02-19) |
| Farmbrook Rd / Porchester Dr | 2026-02-19 | recent | vehicle/bike/ped | 14 | 418980406 | 2.0 | yes | YES (2026-02-19) |
| Porchester Dr / Nelson St | 2026-02-19 | recent | vehicle/ped | 14 | 259698521 | 0.8 | yes | YES (2026-02-19) |
| Perivale Cres / Dignam Crt | 2026-02-19 | recent | vehicle/bike/ped | 14 | 278359874 | 1.0 | yes | YES (2026-02-19) |
| Amberjack Blvd / Bellamy Rd N / Lynnbrook Dr | 2026-02-19 | recent | vehicle/bike/ped | 14 | 134209636 | 2.1 | yes | YES (2026-02-19) |
| Brimley Rd / Gully Dr / Knob Hill Park Trl | 2026-04-09 | recent | vehicle/bike/ped | 14 | 418982515 | 0.2 | yes | YES (2026-04-09) |
| Farmbrook Rd / Nelson St | 2026-04-14 | recent | vehicle/bike/ped | 14 | 418980436 | 1.0 | yes | YES (2026-04-14) |
| Rochman Blvd / Bellamy Rd N / Ben Alder Dr | 2026-04-28 | recent | vehicle/bike/ped | 14 | 281308180 | 1.1 | yes | YES (2026-04-28) |
| Markham Rd / 435 Markham Rd / Blakemanor Blvd | 2026-05-05 | recent | vehicle/bike/ped | 14 | 266262066 | 1.4 | yes | YES (2026-05-05) |
| Brimley Rd / Progress Ave | 2026-05-05 | recent | vehicle/bike/ped | 14 | cluster_648905220_648905225_648905395_648905399 | 3.6 | yes | YES (2026-05-05) |
| Bellamy Rd N / Northleigh Dr | 2026-06-16 | recent | vehicle/bike/ped | 14 | 427658763 | 0.3 | yes | YES (2026-06-16) |
| Lawrence Ave E / Orton Park Rd | 2026-06-30 | recent | vehicle/bike/ped | 14 | cluster_427757616_427761342 | 0.9 | yes | YES (2026-06-30) |
| Lawrence Ave E / Overture Rd | 2026-06-30 | recent | vehicle/bike/ped | 14 | 33510585 | 2.2 | yes | YES (2026-06-30) |
| Lawrence Ave E / Fortune Gt | 2026-06-30 | recent | vehicle/bike/ped | 14 | cluster_427760918_427761463 | 1.3 | yes | YES (2026-06-30) |
| Lawrence Ave E / Mossbank Dr | 2026-06-30 | recent | vehicle/bike/ped | 14 | 59834239 | 2.3 | yes | YES (2026-06-30) |
| McCowan Rd / Triton Rd | 2015-04-29 | aging | vehicle/bike/ped | 8R | 648921946 | 7.2 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / St Andrews Rd | 2015-04-29 | aging | vehicle/bike/ped | 8R | 427653717 | 1.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Dale Ave | 2015-11-17 | aging | vehicle/bike/ped | 8R | cluster_13683605848_277155017_4546532356 | 7.8 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Midland Ave / Cosentino Dr | 2016-03-08 | aging | vehicle/bike/ped | 8R | 272064236 | 0.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Brimley N / Brimley Rd / Brimley Rd N / Hwy 401 Collectors W Ramp | 2016-03-08 | aging | vehicle/bike/ped | 8R | 32474244 | 14.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Progress Ave / Borough Dr | 2016-03-08 | aging | vehicle/bike/ped | 8R | cluster_648905175_648905180_648905206_648905210 | 5.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Progress Ave / Cosentino Dr | 2016-03-08 | aging | vehicle/bike/ped | 8R | 32472831 | 1.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Grangeway Ave / Bushby Dr | 2016-03-10 | aging | vehicle/bike/ped | 8R | cluster_288056887_288056891 | 15.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Lee Centre Dr / Corporate Dr | 2016-03-21 | aging | vehicle/ped | 8R | 306312321 | 2.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Borough Approach E / Borough Dr | 2016-03-21 | aging | vehicle/ped | 8R | cluster_297561876_297561880 | 1.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Borough Dr / Borough Approach W / Brian Harrison Way | 2016-03-21 | aging | vehicle/bike/ped | 8R | cluster_32476083_32476096 | 2.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Brimley Rd / Hwy 401 Collectors E Brimley S Ramp | 2016-03-21 | aging | vehicle/ped | 8R | 429376604 | 13.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Progress Ave / Estate Dr (East) | 2016-03-21 | aging | vehicle/bike/ped | 8R | 252423882 | 3.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Progress Ave / Estate Dr (West) | 2016-03-21 | aging | vehicle/ped | 8R | 252423709 | 0.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Ellesmere Rd / Stoneton Dr | 2016-03-21 | aging | vehicle/bike/ped | 8R | 278364244 | 0.2 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Ellesmere Rd / Packard Blvd | 2016-03-21 | aging | vehicle/bike/ped | 8R | 427653814 | 7.5 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Ellesmere Rd / Oakley Blvd | 2016-03-21 | aging | vehicle/bike/ped | 8R | 272058831 | 4.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Homestead Rd / Lawrence Ave E | 2016-03-23 | aging | vehicle/bike/ped | 8S | 44253827 | 0.5 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / Meldazy Dr (South) | 2016-04-26 | aging | vehicle/ped | 8R | 32476157 | 1.5 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Birkdale Rd / Dorcot Ave | 2016-11-17 | aging | vehicle/bike/ped | 8R | 427653650 | 2.5 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Holmfirth Ter / Greencrest Crct | 2017-01-24 | aging | vehicle/bike/ped | 8S | 427759813 | 1.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Eastpark Blvd / Bellamy Rd N | 2017-02-15 | aging | vehicle/bike/ped | 8S | 306732434 | 1.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Saunders Rd / Guildcrest Dr | 2017-03-28 | aging | vehicle/ped | 8R | cluster_241346019_241346021 | 1.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Galloway Rd / Waldock St | 2017-09-05 | aging | vehicle/bike/ped | 8S | 277490654 | 1.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Amberjack Blvd / Bellamy Rd N | 2017-12-14 | aging | vehicle/bike/ped | 8S | 278364185 | 1.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Morningside Ave / Cumber Ave / Fordover Dr | 2018-03-22 | aging | vehicle/bike/ped | 8S | 276553722 | 2.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Dolly Varden Blvd / Brimorton Dr | 2018-04-17 | aging | vehicle/bike/ped | 8S | 427658973 | 5.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Daphne Rd / Greencedar Crct | 2018-05-02 | aging | vehicle/bike/ped | 8S | 134219978 | 1.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Vanwart Dr / Holmfirth Ter | 2018-05-09 | aging | vehicle/bike/ped | 8S | 427759939 | 2.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Dale Ave | 2018-05-22 | aging | vehicle/bike/ped | 8R | 277155255 | 9.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Lawrence Ave E / Andover Cres | 2018-05-23 | aging | vehicle/bike/ped | 8R | 33511846 | 3.8 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Markham Rd / Scranton Rd | 2018-10-04 | aging | vehicle/bike/ped | 8R | 281321879 | 2.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Ling Rd / Morningside Ave | 2018-12-18 | aging | vehicle/bike/ped | 8S | 33539503 | 1.2 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / Hurley Cres | 2019-02-20 | aging | vehicle/bike/ped | 8R | 276485804 | 2.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / Benleigh Dr / Bendale Park Trl / Thomson Memorial Park Trl | 2019-02-20 | aging | vehicle/ped | 8S | 427659308 | 3.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Brimley Rd / Seminole Ave | 2019-04-04 | aging | vehicle/bike/ped | 8S | 418979990 | 1.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Densgrove Rd / Mossbank Dr | 2019-06-05 | aging | vehicle/bike/ped | 8S | 427760953 | 1.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Painted Post Dr | 2019-06-12 | aging | vehicle/bike/ped | 8S | 427759325 | 3.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scunthorpe Rd / Milner Ave | 2019-07-22 | aging | vehicle/bike/ped | 8R | 428864875 | 1.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Confederation Dr | 2019-10-01 | aging | vehicle/bike/ped | 8S | 137438655 | 1.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Military Trl / 1275 Military Trl | 2019-12-18 | aging | vehicle/bike/ped | 8S | 558592351 | 0.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Milner Ave / Milner Business Crt | 1996-02-29 | stale | vehicle/bike/ped | 8R | 257892410 | 6.2 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Lawrence Ave E / Susan St | 1997-11-20 | stale | vehicle/bike/ped | 8R | 59834272 | 1.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / Meldazy Dr (North) | 1998-10-22 | stale | vehicle/bike/ped | 8R | 276485263 | 2.2 | yes | no — pre-2020 count — outside the 2020s raw resource |
| McCowan Rd / Bellechasse St | 1999-10-04 | stale | vehicle/bike/ped | 8R | 427658545 | 2.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Hwy 401 Collectors E Ramp / Progress Ave / Progress Ave N | 2006-01-31 | stale | vehicle/bike/ped | 8R | 257891924 | 11.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Muir Dr | 2006-05-23 | stale | vehicle/bike/ped | 8R | 418525158 | 6.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Lawrence Ave E / Marcos Blvd | 2006-11-15 | stale | vehicle/bike/ped | 8S | 127756003 | 2.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Overture Rd / Payzac Ave | 2009-09-09 | stale | vehicle/ped | 8R | cluster_32346403_33510647 | 0.8 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Par Ave | 2009-09-16 | stale | vehicle/ped | 8R | 427760820 | 0.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Brimley Rd / Grittani Lane (South) | 2009-10-26 | stale | vehicle/ped | 8R | 425644420 | 7.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Celeste Dr | 2009-12-01 | stale | vehicle/ped | 8R | cluster_241350940_32346410 | 1.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Orton Park Rd / Brimorton Dr | 2010-01-28 | stale | vehicle/ped | 8R | 427761267 | 3.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Service Rd / Duncombe Blvd | 2010-03-04 | stale | vehicle/bike/ped | 8R | 418523964 | 1.5 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Scarborough Golf Club Rd / Marcella St | 2011-01-20 | stale | vehicle/ped | 8R | 427760134 | 1.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Old Kingston Rd (West) | 2011-01-20 | stale | vehicle/bike/ped | 8R | cluster_32459984_32459985 | 1.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Bellamy Rd N / Benleigh Dr | 2011-02-08 | stale | vehicle/bike/ped | 8R | cluster_281310765_281313230_9690520599 | 9.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Toyota Pl / Corporate Dr | 2011-09-19 | stale | vehicle/ped | 8R | 648921978 | 1.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Markham Rd / Gatineau Hydro Corridor Trl (North) | 2014-03-03 | stale | vehicle/bike/ped | 8R | 8721888316 | 18.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Hwy 401 Collectors W Markham Rd Ramp / Markham Rd | 2014-03-29 | stale | vehicle/bike/ped | 8R | cluster_37376709_37404088 | 3.0 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Markham Rd / Painted Post Dr (North) | 2014-04-08 | stale | vehicle/bike/ped | 8R | 427751336 | 1.8 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Markham Rd / Stevenwood Rd / Eastpark Blvd | 2014-04-08 | stale | vehicle/bike/ped | 8R | 427761345 | 0.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Markham Rd / Cougar Crt | 2014-04-08 | stale | vehicle/bike/ped | 8R | 266262552 | 7.1 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Hwy 401 Collectors E Markham Rd N Ramp / Markham Rd | 2014-06-07 | stale | vehicle/bike/ped | 8R | cluster_38067001_382873732 | 13.7 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Morningside Ave / Greyabbey Trl / Guildwood Pkwy | 2014-10-21 | stale | vehicle/ped | 8R | 33513001 | 2.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Poplar Rd / Guildwood Pkwy | 2014-10-22 | stale | vehicle/ped | 8R | 33512996 | 1.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Dearham Wood / Poplar Rd / Cumber Ave | 2014-10-22 | stale | vehicle/ped | 8R | 277157035 | 1.3 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Dearham Wood / Galloway Rd | 2014-10-22 | stale | vehicle/ped | 8R | 277157027 | 1.4 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Galloway Rd / Guildwood Pkwy / Guildwood Park Trl | 2014-10-22 | stale | vehicle/ped | 8R | 33512993 | 0.6 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Kingston Rd / Poplar Rd | 2014-10-22 | stale | vehicle/ped | 8R | cluster_241355529_241355530 | 3.9 | yes | no — pre-2020 count — outside the 2020s raw resource |
| Manse Rd / Hainford St | 2022-02-01 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Glenthorne Dr / Watson St | 2022-02-15 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Old Kingston Rd / Military Trl | 2022-02-24 | recent | vehicle/bike/ped | 8R | 296406087 | 89.8 | NO | — |
| Eglinton Ave E / Huntington Ave | 2022-03-08 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Kingston Rd / Parkcrest Dr | 2022-06-01 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Radnor Ave / Flora Dr | 2022-09-29 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Mason Rd / Knowlton Dr | 2022-11-23 | recent | vehicle/bike/ped | 8S | 418523623 | 136.7 | NO | — |
| Ellesmere Rd / Morrish Rd | 2022-12-17 | recent | vehicle/ped | 8R | 428492020 | 34.1 | NO | — |
| Grantown Ave / Calverley Trl | 2023-02-14 | recent | vehicle/bike/ped | 8S | — | — | NO | — |
| Kennedy Rd / Stratton Ave / Kingsdown Dr | 2023-05-10 | recent | vehicle/bike/ped | 8R | — | — | NO | — |
| Military Trl / Bonspiel Dr | 2023-06-01 | recent | vehicle/bike/ped | 8S | — | — | NO | — |
| Kennedy Rd / Mike Myers Dr | 2023-11-02 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Brimley Rd / Walkway S of Sheppard and W of Brimley | 2024-11-02 | recent | vehicle/bike/ped | 14 | 425644539 | 147.2 | NO | — |
| Danforth Rd / Neston Ave / Tyne Crt | 2024-11-02 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Danforth Rd / Eglinton Ave E | 2024-11-02 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Danforth Rd / Brimley Rd | 2024-11-02 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Midland Ave / Gilder Dr / Lord Roberts Dr | 2024-11-23 | recent | vehicle/bike/ped | 14 | 7224990925 | 74.8 | NO | — |
| Midland Ave / Midwest Rd (North) | 2024-11-23 | recent | vehicle/bike/ped | 14 | 12870925072 | 46.6 | NO | — |
| Midland Ave / Emblem Crt | 2024-11-23 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Midland Ave / Wainfleet Rd / Broadbent Ave | 2024-11-23 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Midland Ave / Progress Ave | 2024-11-24 | recent | vehicle/bike/ped | 14 | 32472833 | 58.6 | NO | — |
| Eglinton Ave E / Midland Ave | 2024-11-24 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Kingston Rd / Mason Rd | 2025-05-28 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Kingston Rd / Whitecap Blvd | 2025-06-17 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Kingston Rd / Beechgrove Dr | 2025-06-17 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Kennedy Rd / Lawrence Ave E | 2025-06-25 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Ellesmere Rd / Midland Ave | 2025-06-25 | recent | vehicle/bike/ped | 14 | 469705485 | 95.7 | NO | — |
| Asterfield Dr / Green Ash Ter | 2025-08-26 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Eglinton Ave E (id: 13452567) | 2025-09-24 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Sheppard Ave E / Shorting Rd | 2025-10-19 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Markham Rd / Kingston Rd | 2025-10-28 | recent | vehicle/bike/ped | 14 | 9349929996 | 66.1 | NO | — |
| Brimley Rd / Eglinton Ave E | 2025-11-18 | recent | vehicle/bike/ped | 14 | 433599658 | 48.1 | NO | — |
| McCowan Rd / Bridlegrove Dr / McCowan District Park Trl | 2025-11-22 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Eglinton Ave E / Barbados Blvd | 2025-11-22 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Eglinton Ave E / Falmouth Ave / Gilder Dr | 2025-11-22 | recent | vehicle/bike/ped | 14 | — | — | NO | — |
| Homestead Rd / Coronation Dr | 2026-01-22 | recent | vehicle/bike/ped | 14 | 277490924 | 144.9 | NO | — |
| Neilson Rd / Gatineau Hydro Corridor Trl | 2026-04-21 | recent | vehicle/bike/ped | 14 | 11749856482 | 68.2 | NO | — |
| Ellesmere Rd / Bobmar Rd | 2026-05-05 | recent | vehicle/bike/ped | 14 | 428477251 | 70.5 | NO | — |
| Kennedy Rd / Bertrand Ave | 2015-07-23 | aging | vehicle/bike/ped | 8R | — | — | NO | — |
| Milner Ave / Dailing Gt | 2017-03-20 | aging | vehicle/bike/ped | 8R | 414466528 | 69.0 | NO | — |
| Markham Rd / Rosebank Dr | 2017-04-05 | aging | vehicle/bike/ped | 8R | — | — | NO | — |
| Kennedy Rd / Cornwallis Dr | 2017-11-28 | aging | vehicle/bike/ped | 8R | — | — | NO | — |
| Collinsgrove Rd / 25 Collinsgrove Rd | 2018-05-24 | aging | vehicle/bike/ped | 8R | 32346406 | 147.2 | NO | — |
| Collinsgrove Rd / 55 Collinsgrove Rd | 2018-05-30 | aging | vehicle/bike/ped | 8R | 842303151 | 123.4 | NO | — |
| Ionview Rd / Bertrand Ave | 2018-10-31 | aging | vehicle/bike/ped | 8S | — | — | NO | — |
| Kennedy Rd / Ranstone Gdns / Jack Goodlad Park Trl | 2018-12-19 | aging | vehicle/bike/ped | 8R | — | — | NO | — |
| Kennedy Rd / Radnor Ave | 2019-01-08 | aging | vehicle/bike/ped | 8S | — | — | NO | — |
| Bobmar Rd / Military Trl | 2019-01-09 | aging | vehicle/bike/ped | 8S | — | — | NO | — |
| Kennedy Rd / Landseer Rd | 2019-12-18 | aging | vehicle/bike/ped | 8R | — | — | NO | — |
| Hwy 401 / Hwy 401 Collectors E Brimley Ramp | 2019-12-19 | aging | vehicle/bike/ped | 8R | 135952892#1-AddedOnRampNode | 76.8 | NO | — |
| Kingston Rd / 3430 Kingston Rd | 2006-05-24 | stale | vehicle/ped | 8R | — | — | NO | — |
| Kingston Rd / Lochleven Dr | 2006-05-24 | stale | vehicle/ped | 8R | — | — | NO | — |
| Midland Ave / Goodland Gt | 2009-04-15 | stale | vehicle/ped | 8R | — | — | NO | — |
| Nantucket Blvd / Wickware Gt | 2010-03-03 | stale | vehicle/bike/ped | 8R | — | — | NO | — |
| Ellesmere Rd / Calverley Trl | 2014-10-07 | stale | vehicle/bike/ped | 8S | — | — | NO | — |

## TMC midblock rows (19) — multimodal short counts, NOT intersection turning movements (kept out of the intersections-covered number)

| location | latest count | recency | modes | edge | dist (m) | matched |
|---|---|---|---|---|---|---|
| Progress Ave: Markham Rd - Progress Ave N / Hwy 401 Collectors E Ramp | 2022-02-23 | recent | vehicle/bike/ped | 607539909 | 0.9 | yes |
| Progress Ave: Borough Dr - Hwy 401 Collectors E / Progress Av Ramp | 2022-02-23 | recent | vehicle/bike/ped | 35348906#0 | 6.6 | yes |
| Hwy 401 Collectors E / Hwy 401 Express E (id: 107389) | 2023-07-25 | recent | vehicle/bike/ped | 23128716 | 1.5 | yes |
| Morningside Ave: Lawrence Ave E - Kingston Rd | 2023-12-10 | recent | vehicle/bike/ped | -36804807#3 | 5.0 | yes |
| Corporate Dr: Consilium Pl - Lee Centre Dr | 2024-04-21 | recent | vehicle/bike/ped | 354413103 | 4.4 | yes |
| Scarborough Golf Club Rd: Hill Cres - 50 Scar Golf Club Rd | 2025-04-10 | recent | vehicle/ped | -35303763#3 | 1.2 | yes |
| Lawrence Ave E: Danielle Moore Crcl - Marcos Blvd | 2025-05-28 | recent | vehicle/bike/ped | 507321553#0 | 7.8 | yes |
| Lawrence Ave E: Greencedar Crct - Markham Rd | 2025-12-03 | recent | vehicle/bike/ped | -36797497#6 | 6.2 | yes |
| McCowan Rd: Ellesmere Rd - Town Centre Crt | 2015-04-29 | aging | vehicle/bike/ped | 50888397#0 | 4.1 | yes |
| McCowan Rd: Lawrence Ave E - Benleigh Dr | 2015-05-04 | aging | vehicle/bike/ped | -36785025 | 3.2 | yes |
| Morningside Ave: Beath St - Morningside Park Trl | 2016-03-02 | aging | vehicle/ped | -14608667 | 3.9 | yes |
| Progress Ave: Bellamy Rd N - Production Dr | 2016-03-21 | aging | vehicle/ped | 252976982#0 | 4.2 | yes |
| Midland Ave: Brockley Dr - Norbury Cres | 2016-12-14 | aging | vehicle/bike/ped | -340173402#3 | 4.1 | yes |
| McCowan Rd: Triton Rd - McCowan Rd S / Progress Ave Ramp | 1985-03-14 | stale | vehicle/ped | 27121806#1 | 9.6 | yes |
| Sheppard Ave E: McCowan Rd - Shorting Rd | 1994-09-19 | stale | vehicle/ped | -36921183#3 | 4.6 | yes |
| Lawrence Ave E: Brockley Dr - Danielle Moore Crcl | 2001-09-25 | stale | vehicle/bike/ped | 33635429#2 | 6.3 | yes |
| Progress Ave: William Kitchen Rd - Midland Ave | 2022-02-23 | recent | vehicle/ped | — | — | NO |
| Pan Am Dr: Morningside Ave - Military Trl | 2026-05-12 | recent | vehicle/bike/ped | — | — | NO |
| Triton Rd: Borough Dr - McCowan Rd | 1985-04-17 | stale | vehicle/ped | 190539058#0 | 88.4 | NO |

## SVC midblock counts in-corridor (786; matched 648)

| location | type | latest count | recency | avg daily vol | wkdy AM peak (vol) | edge | dist (m) | matched | flags |
|---|---|---|---|---|---|---|---|---|---|
| Scarborough Golf Club Rd: Confederation Dr - Marcella St | ATR_SPEED_VOLUME | 2020-02-11 | recent | 9697.7 | 08:15:00 (567) | -36796071#1 (pair) | 4.4 | yes | — |
| Pitfield Rd: Stonewall Gt - Tidworth Sq | ATR_SPEED_VOLUME | 2020-03-10 | recent | 3230.3 | 08:15:00 (299) | -36548449#8 (pair) | 1.1 | yes | — |
| Pitfield Rd to Terryhill Cres | ATR_SPEED_VOLUME | 2020-03-10 | recent | 3263.7 | 08:00:00 (307) | 36548449#2 (pair) | 0.5 | yes | — |
| Pitfield Rd: Charterhouse Rd - Hallbank Ter | ATR_SPEED_VOLUME | 2020-03-10 | recent | 3608.3 | 08:15:00 (354) | -36548449#14 (pair) | 1.3 | yes | — |
| Dunelm St: Cedar Dr - Scarborough Golf Club Rd | ATR_SPEED_VOLUME | 2020-09-21 | recent | 1654.3 | 08:30:00 (93) | 43171753 (pair) | 2.3 | yes | — |
| Nelson St: Farmbrook Rd - Blakemanor Blvd | ATR_SPEED_VOLUME | 2020-09-21 | recent | 1266.1 | 08:15:00 (90) | 35835681 (pair) | 1.8 | yes | — |
| Guildwood Pkwy: Navarre Cres - Galloway Rd | ATR_SPEED_VOLUME | 2020-09-21 | recent | 4786.4 | 08:00:00 (454) | 500279608#3 (pair) | 2.0 | yes | — |
| Warnsworth St: Falaise Rd - Rodda Blvd | ATR_SPEED_VOLUME | 2020-09-21 | recent | 2356.7 | 08:15:00 (117) | -36859227#1 (pair) | 2.5 | yes | — |
| Cedar Brae Blvd: Amarillo Dr - Braeburn Blvd | ATR_SPEED_VOLUME | 2020-11-03 | recent | 647 | 08:45:00 (46) | -37229620 (pair) | 2.3 | yes | — |
| Luella St: Conn Smythe Dr - Centre St | ATR_SPEED_VOLUME | 2020-11-03 | recent | 844.7 | 08:00:00 (44) | 43224339#0 (pair) | 2.8 | yes | — |
| Farmbrook Rd: Chestermere Blvd - West Highland Creek Trl | ATR_SPEED_VOLUME | 2020-11-03 | recent | 687.7 | 08:30:00 (69) | -35835693#3 (pair) | 0.5 | yes | — |
| Marcos Blvd to Cicerella Cres | ATR_SPEED_VOLUME | 2021-03-09 | recent | 694 | 08:00:00 (82) | 118670825#3 (pair) | 1.9 | yes | — |
| Brimley Rd: Pitfield Rd - Walkway S of Sheppard and W of Brimley | ATR_SPEED_VOLUME | 2021-09-21 | recent | 22947.3 | 08:30:00 (1887) | 61108948#0 (pair) | 2.5 | yes | — |
| Brimorton Dr: Amberjack Blvd - Dolly Varden Blvd | ATR_SPEED_VOLUME | 2021-09-21 | recent | 4309.7 | 08:00:00 (343) | -36784240#3 (pair) | 0.0 | yes | — |
| Invergordon Ave: Havenview Rd - Thistlewaite Cres | ATR_SPEED_VOLUME | 2021-09-21 | recent | 2026 | 08:00:00 (202) | 36886057 (pair) | 1.5 | yes | — |
| Invergordon Ave: Glenstroke Dr - Havenview Rd | ATR_SPEED_VOLUME | 2021-09-21 | recent | 2089.7 | 08:00:00 (200) | -36886064#4 (pair) | 0.9 | yes | — |
| Invergordon Ave: Kimroy Grv - Tineta Cres | ATR_SPEED_VOLUME | 2021-09-21 | recent | 2933 | 08:00:00 (254) | 36886086#0 (pair) | 1.5 | yes | — |
| Invergordon Ave: Tineta Cres - Kimroy Grv | ATR_SPEED_VOLUME | 2021-09-21 | recent | 3104 | 08:00:00 (260) | 36886061#0 (pair) | 1.3 | yes | — |
| Pegasus Trl: Portico Dr - Griselda Cres | ATR_SPEED_VOLUME | 2021-10-19 | recent | 418.7 | 08:45:00 (25) | -1312645393#13 (pair) | 1.9 | yes | — |
| Pegasus Trl: Cotteswood Pl - Minos Cres | ATR_SPEED_VOLUME | 2021-10-19 | recent | 293.7 | 07:45:00 (22) | 1312645393#6 (pair) | 2.3 | yes | — |
| Cedar Dr: Gatesview Ave - Dunelm St | ATR_SPEED_VOLUME | 2021-10-19 | recent | 499 | 09:15:00 (25) | 22486540#0 (pair) | 2.6 | yes | — |
| Canadine Rd: Midland Ave - Oakley Blvd | ATR_SPEED_VOLUME | 2021-10-19 | recent | 496 | 07:30:00 (34) | 36783683#0 (pair) | 0.5 | yes | — |
| Oakley Blvd: Canadine Rd - Ellesmere Rd | ATR_SPEED_VOLUME | 2021-10-19 | recent | 1131 | 08:00:00 (93) | -36783537#3 (pair) | 2.0 | yes | — |
| Dormington Dr: Ellesmere Rd - Pegasus Trl | ATR_SPEED_VOLUME | 2021-10-19 | recent | 1466.3 | 07:45:00 (176) | -36796097#6 (pair) | 2.2 | yes | — |
| Cedar Dr: Eglinton Ave E - Gatesview Ave | ATR_SPEED_VOLUME | 2021-10-19 | recent | 491.3 | 09:15:00 (25) | -43171304#10 (pair) | 2.1 | yes | — |
| Pegasus Trl: Minos Cres - Castor Cres | ATR_SPEED_VOLUME | 2021-10-19 | recent | 281.3 | 08:15:00 (22) | 1312645393#3 (pair) | 2.4 | yes | — |
| Lynnbrook Dr: Earlthorpe Cres - Parkington Cres | ATR_SPEED_VOLUME | 2021-11-30 | recent | 301 | 07:45:00 (43) | 36784287#0 (pair) | 1.7 | yes | — |
| Confederation Dr: Kollar Dr - Palacky St | ATR_SPEED_VOLUME | 2021-11-30 | recent | 1431.3 | 08:45:00 (104) | 36795793#4 (pair) | 0.6 | yes | — |
| Toynbee Trl: Somerdale Sq - Regency Sq | ATR_SPEED_VOLUME | 2021-11-30 | recent | 762.3 | 08:00:00 (83) | -35403961#3 (pair) | 1.8 | yes | — |
| Toynbee Trl: Navarre Cres - Dearham Wood | ATR_SPEED_VOLUME | 2021-11-30 | recent | 688.3 | 08:00:00 (95) | 35403961#1 (pair) | 2.0 | yes | — |
| Toynbee Trl: Guildwood Village Park Trl - Nuffield Dr | ATR_SPEED_VOLUME | 2021-11-30 | recent | 433.7 | 08:15:00 (39) | 1302261845#5 (pair) | 2.6 | yes | — |
| Coronation Dr: Darlingside Dr - Manse Rd | VEHICLE_CLASS | 2021-11-30 | recent | 4691.3 | 07:30:00 (582) | -8162944#0 (pair) | 2.1 | yes | — |
| Galloway Rd: Waldock St - Coronation Dr | ATR_SPEED_VOLUME | 2022-04-05 | recent | 2822.7 | 08:00:00 (342) | -1073334801#3 (pair) | 0.6 | yes | — |
| Gatesview Ave: Scarborough Village Park Trl - Scarborough Golf Club Rd | ATR_SPEED_VOLUME | 2022-04-05 | recent | 588.7 | 08:00:00 (67) | 1493242448#0 (pair) | 2.9 | yes | — |
| Brockley Dr: Lawrence Ave E - Archibald Mews | ATR_SPEED_VOLUME | 2022-04-19 | recent | 2034 | 08:00:00 (338) | -36783687#10 (pair) | 2.2 | yes | — |
| Kingston Rd: Scarborough Golf Club Rd - 3752 Kingston Rd | ATR_SPEED_VOLUME | 2022-05-31 | recent | 29004 | 08:15:00 (1693) | 445878559#0 (pair) | 7.5 | yes | — |
| Kingston Rd: Markham Rd - Brinloor Blvd | ATR_SPEED_VOLUME | 2022-05-31 | recent | 22174.7 | 08:00:00 (1517) | 48715757#0 (pair) | 8.2 | yes | — |
| Lawrence Ave E: Burnview Cres - Ben Stanton Blvd | ATR_SPEED_VOLUME | 2022-05-31 | recent | 21428 | 08:15:00 (1192) | 43307631#2 (pair) | 6.3 | yes | — |
| Dolly Varden Blvd: Daventry Rd - Bluefin Cres | ATR_SPEED_VOLUME | 2022-08-30 | recent | 539.3 | 09:15:00 (28) | -36784229#1 (pair) | 0.0 | yes | — |
| Dolly Varden Blvd to Bluefin Cres | ATR_SPEED_VOLUME | 2022-08-30 | recent | 574 | 09:15:00 (29) | 36784229#2 (pair) | 2.6 | yes | — |
| Morningside Ave: Cumber Ave - Pixley Cres | VEHICLE_CLASS | 2022-09-14 | recent | 6638.1 | 07:45:00 (598) | 26020474#2 (pair) | 4.8 | yes | — |
| Poplar Rd: Portia St - Gardentree St | VEHICLE_CLASS | 2022-09-14 | recent | 987.4 | 08:15:00 (93) | -1489278773#1 (pair) | 2.2 | yes | — |
| Mason Rd: Knowlton Dr - Glenda Rd | ATR_SPEED_VOLUME | 2022-09-27 | recent | 2326 | 08:15:00 (178) | 43328162#0 (pair) | 2.3 | yes | — |
| Hill Cres: Bethune Blvd - Scarborough Golf Club Rd | ATR_SPEED_VOLUME | 2023-01-10 | recent | 1117 | 08:00:00 (118) | 500279618#2 (pair) | 1.3 | yes | — |
| Hill Cres: Muir Dr - Bethune Blvd | ATR_SPEED_VOLUME | 2023-01-10 | recent | 1455 | 08:00:00 (183) | 500279618#1 (pair) | 1.8 | yes | — |
| Gander Dr: Chancellor Dr - Ellesmere Rd | ATR_SPEED_VOLUME | 2023-01-10 | recent | 2014.7 | 08:00:00 (210) | -36795835#1 (pair) | 1.9 | yes | — |
| Coronation Dr: Galloway Rd - Poplar Rd | ATR_SPEED_VOLUME | 2023-03-21 | recent | 2307 | 08:00:00 (222) | -36859033#5 (pair) | 2.5 | yes | — |
| Guildwood Pkwy: Livingston Rd - Chancery Lane | ATR_SPEED_VOLUME | 2023-03-21 | recent | 5062.7 | 07:15:00 (483) | 5023698#0 (pair) | 1.1 | yes | — |
| Guildwood Pkwy: Galloway Rd - Forsythia Dr | ATR_SPEED_VOLUME | 2023-03-21 | recent | 4435.3 | 08:15:00 (479) | -500279608#6 (pair) | 2.5 | yes | — |
| Guildwood Pkwy: Scarcliff Gdns - Morna Ave | ATR_SPEED_VOLUME | 2023-03-21 | recent | 3829.7 | 08:00:00 (352) | 1490790725#1 (pair) | 2.6 | yes | — |
| Guildwood Pkwy to Guildwood Park Trl (id: 30090074) | ATR_SPEED_VOLUME | 2023-03-21 | recent | 5031.3 | 08:30:00 (592) | 500279608#0 (pair) | 1.9 | yes | — |
| Trudelle St: Trudelle Park Trl - McCowan Rd | ATR_SPEED_VOLUME | 2023-03-28 | recent | 4502.7 | 08:00:00 (303) | 35798452#0 (pair) | 0.4 | yes | — |
| Applefield Dr: Tordale Cres - Verlaine Pl | ATR_SPEED_VOLUME | 2023-04-18 | recent | 443.7 | 08:00:00 (26) | 36783599 (pair) | 2.8 | yes | — |
| Applefield Dr: Birkdale Ravine Trl - Waterfield Dr | ATR_SPEED_VOLUME | 2023-04-18 | recent | 151.7 | 09:15:00 (10) | -36783529#3 (pair) | 2.7 | yes | — |
| Ellesmere Rd: Birkdale Rd - Birkdale Ravine Trl | ATR_SPEED_VOLUME | 2023-05-09 | recent | 32207.9 | 08:00:00 (2429) | 835375613#0 (pair) | 4.0 | yes | — |
| Brimley Rd: Knob Hill Park Trl - Gully Dr | ATR_SPEED_VOLUME | 2023-05-09 | recent | 19930.7 | 08:15:00 (1262) | -37229937#8 (pair) | 4.2 | yes | — |
| Brimley Rd: Thomson Memorial Park Trl - Birkdale Ravine Trl | ATR_SPEED_VOLUME | 2023-05-09 | recent | 18294.9 | 08:15:00 (1245) | -36783693#1 (pair) | 4.7 | yes | — |
| Midland Ave: Stansbury Cres - Tara Ave | ATR_SPEED_VOLUME | 2023-05-09 | recent | 16714.9 | 08:30:00 (1167) | 1384498770 (pair) | 4.0 | yes | — |
| Midland Ave: Dorcot Ave - Millbridge Gt | ATR_SPEED_VOLUME | 2023-05-09 | recent | 22498 | 08:15:00 (1455) | -320464907#18 (pair) | 4.1 | yes | — |
| McCowan Rd: Danforth Rd - Hollyhedge Dr | ATR_SPEED_VOLUME | 2023-05-09 | recent | 16845 | 08:00:00 (1137) | 129725698#0 (pair) | 4.5 | yes | — |
| Danforth Rd: Furlong Crt - McCowan Rd | ATR_SPEED_VOLUME | 2023-05-09 | recent | 16352.3 | 08:15:00 (1083) | -129726925#1 (pair) | 3.0 | yes | — |
| Military Trl: Bonspiel Dr - Morningside Ave | ATR_SPEED_VOLUME | 2023-06-27 | recent | 3422 | 07:45:00 (204) | 632963007#18 (pair) | 0.1 | yes | — |
| Military Trl: The Meadoway - Bonspiel Dr | ATR_SPEED_VOLUME | 2023-06-27 | recent | 4161.3 | 07:00:00 (283) | 632963007#18 (pair) | 0.0 | yes | — |
| Scarborough Golf Club Rd: Newark Rd - Ellesmere Rd | ATR_SPEED_VOLUME | 2023-07-18 | recent | 13214.3 | 07:45:00 (753) | -36796043#2 (pair) | 3.8 | yes | — |
| Britwell Ave: Stephenfrank Rd - Brimley Rd | ATR_SPEED_VOLUME | 2023-07-18 | recent | 723 | 09:00:00 (40) | 36783635#0 (pair) | 1.3 | yes | — |
| Galloway Rd: Galloway Park Trl - Dunera Ave | ATR_SPEED_VOLUME | 2023-07-18 | recent | 2397.9 | 08:15:00 (180) | -1073334800#2 (pair) | 1.5 | yes | — |
| Military Trl: Bobmar Rd - Scenic Hill Crt | ATR_SPEED_VOLUME | 2023-07-18 | recent | 6476 | 08:00:00 (471) | -227818179#2 (pair) | 2.0 | yes | — |
| Brimorton Dr: Gatineau Hydro Corridor Trl - Gaitwin Pl | ATR_SPEED_VOLUME | 2023-07-18 | recent | 4173.5 | 08:15:00 (219) | -36796037#13 (pair) | 2.1 | yes | — |
| Brimley Rd: Britwell Ave - Thomson Memorial Park Trl | ATR_SPEED_VOLUME | 2023-07-18 | recent | 20297.3 | 08:30:00 (1118) | 320607700#0 (pair) | 3.2 | yes | — |
| Scarborough Golf Club Rd: Chandler Dr - Mossbank Dr | ATR_SPEED_VOLUME | 2023-08-01 | recent | 12913.7 | 08:15:00 (634) | -36795945 (pair) | 3.6 | yes | — |
| Lawrence Ave E: Greenholm Crct - Fortune Gt | ATR_SPEED_VOLUME | 2023-08-01 | recent | 32949.3 | 07:45:00 (2106) | 36798620#0 (pair) | 5.5 | yes | — |
| Ellesmere Rd: Dolly Varden Blvd - Markham Rd | ATR_SPEED_VOLUME | 2023-08-15 | recent | 20161.3 | 08:15:00 (1113) | -1429159874#3 (pair) | 4.5 | yes | — |
| Ellesmere Rd: Markham Rd - Gander Dr | ATR_SPEED_VOLUME | 2023-08-15 | recent | 22466.7 | 08:15:00 (1182) | -1352301891#2 (pair) | 4.1 | yes | — |
| Markham Rd: Ellesmere Rd - Tuxedo Crt | ATR_SPEED_VOLUME | 2023-08-15 | recent | 24376.3 | 07:15:00 (1452) | -37237438#2 (pair) | 5.3 | yes | — |
| Markham Rd: Roman Abraham Blvd - Ellesmere Rd | ATR_SPEED_VOLUME | 2023-08-15 | recent | 20642 | 09:15:00 (1117) | 1317836869 (pair) | 1.9 | yes | — |
| Gage Ave: Seminole Ave - Miramar Cres | ATR_SPEED_VOLUME | 2023-09-12 | recent | 1139.3 | 07:45:00 (132) | -35835641#1 (pair) | 2.9 | yes | — |
| Gage Ave: Kootenay Cres - Kilgreggan Cres | ATR_SPEED_VOLUME | 2023-09-12 | recent | 1101.7 | 08:00:00 (118) | 35835651 (pair) | 2.2 | yes | — |
| Gage Ave: Fraserton Cres - Brimley Rd | ATR_SPEED_VOLUME | 2023-09-12 | recent | 1313.3 | 07:45:00 (104) | -36791856#2 (pair) | 2.7 | yes | — |
| Painted Post Dr: Jutten Crt - Silurian Rd | ATR_SPEED_VOLUME | 2023-09-19 | recent | 1596.3 | 08:00:00 (112) | -36784211 (pair) | 2.3 | yes | — |
| Painted Post Dr: Sedgemount Dr - Lusted Park Trl | ATR_SPEED_VOLUME | 2023-09-19 | recent | 1614.3 | 08:00:00 (116) | -36784183#2 (pair) | 2.6 | yes | — |
| Painted Post Dr: Sharbot Ave - Sophia Dr | ATR_SPEED_VOLUME | 2023-09-19 | recent | 1807.3 | 08:00:00 (100) | -36784261 (pair) | 2.2 | yes | — |
| Painted Post Dr: Silurian Rd - Abbeville Rd | ATR_SPEED_VOLUME | 2023-09-19 | recent | 1639 | 08:00:00 (120) | -36784366 (pair) | 1.9 | yes | — |
| Painted Post Dr: Calumet Cres - Sedgemount Dr | ATR_SPEED_VOLUME | 2023-09-19 | recent | 1442 | 08:00:00 (100) | -36784226#1 (pair) | 1.3 | yes | — |
| Citadel Dr: Bimbrok Rd - Brimley Rd | ATR_SPEED_VOLUME | 2023-10-10 | recent | 1564.7 | 08:15:00 (146) | 35796884#0 (pair) | 0.4 | yes | — |
| Oakmeadow Blvd: Stonefield Cres - Highcastle Rd | ATR_SPEED_VOLUME | 2023-10-17 | recent | 866 | 08:15:00 (128) | 36861120#5 (pair) | 1.7 | yes | — |
| Highcastle Rd: Oakmeadow Blvd - Pineslope Cres | ATR_SPEED_VOLUME | 2023-10-17 | recent | 523 | 08:15:00 (94) | -36861158#0 (pair) | 2.5 | yes | — |
| Packard Blvd: Hurley Cres - Stanwell Dr | ATR_SPEED_VOLUME | 2023-10-24 | recent | 1159 | 08:00:00 (110) | -36783633#1 (pair) | 0.8 | yes | — |
| Brimorton Dr: Neapolitan Dr - Bromton Dr | ATR_SPEED_VOLUME | 2023-10-24 | recent | 4323 | 08:00:00 (392) | -36783655#2 (pair) | 2.1 | yes | — |
| Fitzgibbon Ave: Medina Cres - Romulus Dr | ATR_SPEED_VOLUME | 2023-10-31 | recent | 1103.7 | 08:15:00 (145) | -35835539#2 (pair) | 2.9 | yes | — |
| Fitzgibbon Ave: Tara Ave - Arnott St | ATR_SPEED_VOLUME | 2023-10-31 | recent | 943 | 08:15:00 (142) | -35835547#2 (pair) | 2.2 | yes | — |
| Scarborough Golf Club Rd: Tillinghast Lane - Confederation Dr | ATR_SPEED_VOLUME | 2023-10-31 | recent | 11103 | 08:00:00 (817) | -43171754#6 (pair) | 2.7 | yes | — |
| Lawrence Ave E: Florist Lane - Morningside Ave | ATR_SPEED_VOLUME | 2023-10-31 | recent | 19254.7 | 08:15:00 (1206) | 36804810#0 (pair) | 4.5 | yes | — |
| Manse Rd: Stornoway Crt - Old Kingston Rd | ATR_SPEED_VOLUME | 2023-11-14 | recent | 1202.3 | 08:00:00 (111) | -338407184#2 (pair) | 1.6 | yes | — |
| Old Kingston Rd: Manse Rd - Highland Creek Trl | ATR_SPEED_VOLUME | 2023-11-14 | recent | 5272 | 08:15:00 (413) | 498960133#0 (pair) | 2.8 | yes | — |
| Livingston Rd: Toynbee Trl - Guildwood Village Park Trl | ATR_SPEED_VOLUME | 2023-11-28 | recent | 1989.7 | 08:00:00 (264) | -40789190#3 (pair) | 2.9 | yes | — |
| Ellesmere Rd: Morningside Ave - Military Trl | ATR_SPEED_VOLUME | 2023-12-05 | recent | 11268 | 08:00:00 (983) | 445437309 (pair) | 4.3 | yes | — |
| Ellesmere Rd: Military Trl - Mirrow Crt | ATR_SPEED_VOLUME | 2023-12-05 | recent | 13131.7 | 08:00:00 (1046) | 43921065 (pair) | 4.0 | yes | — |
| Painted Post Dr: Carew Gt - Brimorton Dr | ATR_SPEED_VOLUME | 2023-12-05 | recent | 1715 | 08:00:00 (144) | 36795884#0 (pair) | 2.7 | yes | — |
| Brimorton Dr: Mountland Dr - Painted Post Dr | ATR_SPEED_VOLUME | 2023-12-05 | recent | 3719.7 | 08:00:00 (325) | -36796037#5 (pair) | 2.2 | yes | — |
| Highcastle Rd: Pineslope Cres - Grovenest Dr | ATR_SPEED_VOLUME | 2024-03-05 | recent | 859.3 | 08:30:00 (92) | -36861158#5 (pair) | 2.3 | yes | — |
| Bellamy Rd N: Bridlington St - Lynnbrook Dr | ATR_SPEED_VOLUME | 2024-03-05 | recent | 15277.3 | 08:00:00 (1253) | -1288872291#4 (pair) | 3.1 | yes | — |
| Bellamy Rd N: Ellesmere Rd - Progress Ave | ATR_SPEED_VOLUME | 2024-03-05 | recent | 15692 | 08:00:00 (1180) | 36784858#0 (pair) | 2.0 | yes | — |
| Midland Ave: Wainfleet Rd - Lord Roberts Dr | ATR_SPEED_VOLUME | 2024-03-19 | recent | 20594 | 08:15:00 (1617) | 232196664#0 (pair) | 4.3 | yes | — |
| Van Allan Rd: Willsteven Dr - Stevenvale Dr | ATR_SPEED_VOLUME | 2024-03-19 | recent | 467.3 | 08:30:00 (39) | 36796011#0 (pair) | 1.1 | yes | — |
| Stevenvale Dr: Van Allan Rd - Holmfirth Ter | ATR_SPEED_VOLUME | 2024-03-19 | recent | 586 | 08:30:00 (34) | -36796010#5 (pair) | 2.1 | yes | — |
| Stevenvale Dr: Willsteven Dr - Van Allan Rd | ATR_SPEED_VOLUME | 2024-03-19 | recent | 501.3 | 08:30:00 (26) | -36795921#1 (pair) | 1.0 | yes | — |
| Burnview Cres: Gaiety Dr - Vesper Crt | ATR_SPEED_VOLUME | 2024-03-19 | recent | 1558 | 08:15:00 (140) | 129726366#2 (pair) | 2.1 | yes | — |
| Ben Stanton Blvd: Benfrisco Cres - Benprice Crt | ATR_SPEED_VOLUME | 2024-04-23 | recent | 967 | 07:45:00 (78) | -36784188 (pair) | 2.1 | yes | — |
| Poplar Rd: Coronation Dr - Danzig St | ATR_SPEED_VOLUME | 2024-04-23 | recent | 2071.7 | 08:15:00 (207) | -500275922#2 (pair) | 2.6 | yes | — |
| Poplar Rd: Gardentree St - Waldock St | ATR_SPEED_VOLUME | 2024-04-23 | recent | 1242.7 | 08:15:00 (109) | -1301989568#1 (pair) | 1.4 | yes | — |
| Poplar Rd: Dearham Wood - Portia St | ATR_SPEED_VOLUME | 2024-04-23 | recent | 1007.3 | 08:00:00 (113) | -22486648#6 (pair) | 1.8 | yes | — |
| Sedgemount Dr: Daventry Rd - Pandora Crcl | ATR_SPEED_VOLUME | 2024-04-23 | recent | 711.3 | 07:45:00 (94) | -36784369#2 (pair) | 1.0 | yes | — |
| Lynnbrook Dr: Denver Pl - Huronia Gt | ATR_SPEED_VOLUME | 2024-04-30 | recent | 1366 | 08:00:00 (97) | -36784349#1 (pair) | 1.0 | yes | — |
| Amberjack Blvd: Daventry Rd - Brimorton Dr | ATR_SPEED_VOLUME | 2024-04-30 | recent | 436 | 08:00:00 (47) | -36784256#5 (pair) | 1.5 | yes | — |
| Marcella St: Summerbridge Rd - Susan St | ATR_SPEED_VOLUME | 2024-04-30 | recent | 975.7 | 08:15:00 (69) | 36795869#1 (pair) | 1.3 | yes | — |
| Lynnbrook Dr: Stoneton Dr - Earlthorpe Cres | ATR_SPEED_VOLUME | 2024-04-30 | recent | 607 | 07:45:00 (54) | -36784267#1 (pair) | 2.7 | yes | — |
| Lynnbrook Dr to Sunderland Cres | ATR_SPEED_VOLUME | 2024-04-30 | recent | 784 | 08:00:00 (67) | 89185046#0 (pair) | 0.6 | yes | — |
| Marcella St: Gracemount Cres - Mayhill Cres | ATR_SPEED_VOLUME | 2024-04-30 | recent | 1360 | 08:30:00 (91) | 36796038#0 (pair) | 1.7 | yes | — |
| Lynnbrook Dr to Acre Heights Cres | ATR_SPEED_VOLUME | 2024-04-30 | recent | 795.3 | 08:00:00 (67) | -36784361#1 (pair) | 2.6 | yes | — |
| Stevenwood Rd: Confederation Dr - Markham Rd | ATR_SPEED_VOLUME | 2024-04-30 | recent | 1073 | 08:30:00 (114) | -36795787#1 (pair) | 2.5 | yes | — |
| Confederation Dr: Van Allan Rd - Stevenwood Rd | ATR_SPEED_VOLUME | 2024-04-30 | recent | 2000 | 08:30:00 (121) | -36796081#3 (pair) | 1.7 | yes | — |
| Confederation Dr: Palacky St - Holton Rd | ATR_SPEED_VOLUME | 2024-04-30 | recent | 1615.7 | 08:30:00 (120) | 36795793#6 (pair) | 0.4 | yes | — |
| Confederation Dr: Stevenvale Dr - Kollar Dr | ATR_SPEED_VOLUME | 2024-04-30 | recent | 2528.7 | 08:30:00 (186) | 36795793#1 (pair) | 2.4 | yes | — |
| Dale Ave: Cromwell Rd - Senator Blvd | ATR_SPEED_VOLUME | 2024-05-14 | recent | 648 | 07:45:00 (66) | 36858842#0 (pair) | 0.9 | yes | — |
| Janray Dr: Fortune Gt - Chandler Dr | ATR_SPEED_VOLUME | 2024-05-14 | recent | 947.7 | 08:00:00 (115) | -36795944#1 (pair) | 2.3 | yes | — |
| Dale Ave: Pin Lane - Saunders Rd | ATR_SPEED_VOLUME | 2024-05-14 | recent | 1829.3 | 08:30:00 (138) | 36858844#3 (pair) | 1.3 | yes | — |
| Holmfirth Ter: Stevenvale Dr - Vanwart Dr | ATR_SPEED_VOLUME | 2024-05-14 | recent | 2251 | 08:30:00 (206) | 36795936#0 (pair) | 0.9 | yes | — |
| Grangeway Ave: Ellesmere Rd - Bushby Dr | ATR_SPEED_VOLUME | 2024-06-04 | recent | 5919.7 | 08:00:00 (373) | -205717609#3 (pair) | 2.9 | yes | — |
| Confederation Dr: Scarborough Golf Club Rd - Karen Ann Cres | ATR_SPEED_VOLUME | 2024-06-04 | recent | 1286 | 08:30:00 (81) | 36795880#0 (pair) | 0.1 | yes | — |
| Confederation Dr: Summerbridge Rd - Tingle Cres | ATR_SPEED_VOLUME | 2024-06-04 | recent | 740.3 | 08:15:00 (42) | 36795790#1 (pair) | 2.4 | yes | — |
| Guildwood Pkwy: Forsythia Dr - Schubert Dr | ATR_SPEED_VOLUME | 2024-06-04 | recent | 5337 | 08:15:00 (566) | -500279608#9 (pair) | 1.6 | yes | — |
| Danzig St: Marlena Dr - Betty Frank Gt | ATR_SPEED_VOLUME | 2024-06-04 | recent | 2042 | 07:45:00 (158) | 25465436#6 (pair) | 2.3 | yes | — |
| Pitfield Rd: Garden Park Ave - McDairmid Rd | ATR_SPEED_VOLUME | 2024-06-25 | recent | 2989.3 | 08:15:00 (251) | 36548476 (pair) | 2.2 | yes | — |
| Kollar Dr: Confederation Dr - Beran Dr | ATR_SPEED_VOLUME | 2024-07-09 | recent | 604 | 08:15:00 (24) | -36795969#1 (pair) | 1.7 | yes | — |
| Beran Dr: Cornell Park Trl - Pelmar Pl | ATR_SPEED_VOLUME | 2024-07-09 | recent | 443 | 08:15:00 (13) | -36795792#6 (pair) | 2.3 | yes | — |
| Palacky St: Confederation Dr - Beran Dr | ATR_SPEED_VOLUME | 2024-07-09 | recent | 211.7 | 08:30:00 (5) | -36796094#2 (pair) | 1.9 | yes | — |
| Falaise Rd: Rodda Blvd - Warnsworth St | ATR_SPEED_VOLUME | 2024-08-27 | recent | 882.7 | 08:15:00 (51) | 36859214 (pair) | 2.8 | yes | — |
| Falaise Rd: Kingston Rd - Rodda Blvd | ATR_SPEED_VOLUME | 2024-08-27 | recent | 769 | 08:15:00 (47) | -1278988515#1 (pair) | 2.7 | yes | — |
| Crusader St: Bellamy Rd N - Orville Rd | ATR_SPEED_VOLUME | 2024-08-27 | recent | 911.7 | 09:15:00 (48) | 27898634#0 (pair) | 0.8 | yes | — |
| Farmbrook Rd: Nelson St - Chestermere Blvd | ATR_SPEED_VOLUME | 2024-09-10 | recent | 712.3 | 08:15:00 (100) | -35835690#1 (pair) | 2.3 | yes | — |
| Eastpark Blvd: Daphne Rd - Cedarbrook Park Trl | ATR_SPEED_VOLUME | 2024-10-08 | recent | 2162.7 | 08:15:00 (286) | 27898844#7 (pair) | 1.9 | yes | — |
| Daphne Rd: Eastpark Blvd - Greencedar Crct | ATR_SPEED_VOLUME | 2024-10-08 | recent | 1673.3 | 08:45:00 (125) | -27944954#2 (pair) | 2.2 | yes | — |
| Benshire Dr: Bellechasse St - Jarwick Dr | ATR_SPEED_VOLUME | 2024-10-08 | recent | 632.7 | 07:45:00 (96) | -36784306#2 (pair) | 2.0 | yes | — |
| Botany Hill Rd: Cresswell Dr - Doucett Pl | ATR_SPEED_VOLUME | 2024-10-08 | recent | 380 | 08:30:00 (22) | -36795909#1 (pair) | 1.3 | yes | — |
| Botany Hill Rd: Madras Cres - Bow Valley Dr | ATR_SPEED_VOLUME | 2024-10-08 | recent | 1138.3 | 08:30:00 (84) | 36795975#2 (pair) | 1.2 | yes | — |
| Banmoor Blvd to Landfair Cres | ATR_SPEED_VOLUME | 2024-10-08 | recent | 494.7 | 09:15:00 (33) | 24488203#0 (pair) | 2.4 | yes | — |
| Lawrence Ave E: Greencedar Crct - Markham Rd | ATR_SPEED_VOLUME | 2024-10-22 | recent | 28699 | 07:30:00 (1692) | -36797497#6 (pair) | 6.2 | yes | — |
| Orton Park Rd: Merkley Sq - Slan Ave | ATR_SPEED_VOLUME | 2024-10-29 | recent | 6640 | 08:15:00 (534) | 36795782#0 (pair) | 2.8 | yes | — |
| Orton Park Rd: 371 Orton Park Rd - 400 Orton Park Rd (id: 107216) | ATR_SPEED_VOLUME | 2024-10-29 | recent | 7524 | 08:00:00 (603) | 1484764425#0 (pair) | 2.8 | yes | — |
| Orton Park Rd: Amboy Rd - Thornbeck Dr | ATR_SPEED_VOLUME | 2024-10-29 | recent | 7667 | 08:15:00 (522) | -36795819 (pair) | 2.5 | yes | — |
| Lawrence Ave E: Andover Cres - 4140 Lawrence Ave E | ATR_SPEED_VOLUME | 2024-11-05 | recent | 27258.7 | 08:00:00 (2126) | 1378338179 (pair) | 4.4 | yes | — |
| Torrance Rd: Grace St - Adler St | ATR_SPEED_VOLUME | 2024-11-05 | recent | 1164 | 08:15:00 (167) | -22486528#9 (pair) | 2.0 | yes | — |
| Bendale Blvd: Perivale Cres - Rossander Crt | ATR_SPEED_VOLUME | 2025-01-07 | recent | 165.3 | 09:00:00 (12) | 35835652#0 (pair) | 1.4 | yes | — |
| Bendale Blvd: Seminole Ave - Perivale Cres | ATR_SPEED_VOLUME | 2025-01-07 | recent | 496.7 | 08:15:00 (36) | 35835646#0 (pair) | 2.1 | yes | — |
| Broadbent Ave: Chipper Cres - Chillery Ave | ATR_SPEED_VOLUME | 2025-01-07 | recent | 663.7 | 08:15:00 (107) | -35796837#1 (pair) | 2.5 | yes | — |
| Sancrest Dr to Ada Cres | ATR_SPEED_VOLUME | 2025-01-21 | recent | 245.7 | 08:15:00 (25) | -36783671#2 (pair) | 1.9 | yes | — |
| Brimorton Dr: Meadowglen Pl - Clementine Sq | ATR_SPEED_VOLUME | 2025-03-25 | recent | 5615.3 | 08:00:00 (505) | 36796013 (pair) | 0.8 | yes | — |
| Pineslope Cres: Highcastle Rd - Oakmeadow Blvd | ATR_SPEED_VOLUME | 2025-03-25 | recent | 126 | 08:30:00 (16) | -36861149#3 (pair) | 2.3 | yes | — |
| Sedgemount Dr: Pandora Crcl - Daventry Rd | ATR_SPEED_VOLUME | 2025-04-08 | recent | 956 | 07:45:00 (207) | -36784363#7 (pair) | 2.3 | yes | — |
| Milner Ave: Mid-Dominion Acres - Scunthorpe Rd | ATR_SPEED_VOLUME | 2025-04-16 | recent | 8056 | 08:45:00 (575) | 23799280#5 (pair) | 4.1 | yes | — |
| Scarborough Golf Club Rd: Hill Cres - 50 Scar Golf Club Rd | ATR_SPEED_VOLUME | 2025-04-22 | recent | 1393.3 | 08:15:00 (124) | -35303763#3 (pair) | 1.2 | yes | — |
| Markham Rd: Greencrest Crct - Lawrence Ave E | ATR_SPEED_VOLUME | 2025-04-22 | recent | 22821.7 | 08:15:00 (1345) | 341498243#0 (pair) | 6.1 | yes | — |
| Scarborough Golf Club Rd: Lawrence Ave E - Par Ave | ATR_SPEED_VOLUME | 2025-05-06 | recent | 11423 | 08:15:00 (810) | -36795988#6 (pair) | 4.0 | yes | — |
| Adanac Dr: Bellamy Rd S - Mason Rd | ATR_SPEED_VOLUME | 2025-05-27 | recent | 2953.7 | 08:00:00 (287) | 35798503#0 (pair) | 2.6 | yes | — |
| Cedar Brae Blvd: Braeburn Blvd - Fairway Dr | ATR_SPEED_VOLUME | 2025-05-27 | recent | 411.3 | 09:00:00 (27) | -37229622 (pair) | 2.3 | yes | — |
| Markham Rd: Markanna Dr - Eglinton Ave E | ATR_SPEED_VOLUME | 2025-05-27 | recent | 13553 | 08:15:00 (872) | 417876562#0 (pair) | 3.0 | yes | — |
| Bellamy Rd S: Tollgate Mews - Oakridge Dr | ATR_SPEED_VOLUME | 2025-05-27 | recent | 2527 | 08:15:00 (242) | 35798550 (pair) | 2.3 | yes | — |
| Bellamy Rd S: Stanland Dr - Adanac Dr | ATR_SPEED_VOLUME | 2025-05-27 | recent | 1516 | 08:00:00 (150) | 35798550 (pair) | 2.5 | yes | — |
| Cedar Brae Blvd: Grace St - Danmary Rd | ATR_SPEED_VOLUME | 2025-05-27 | recent | 1235.7 | 08:15:00 (145) | 37229624#0 (pair) | 2.8 | yes | — |
| St Andrews Rd: Thomson Memorial Park Trl - Kencliff Cres | ATR_SPEED_VOLUME | 2025-06-03 | recent | 1116 | 08:00:00 (93) | -36783591#2 (pair) | 1.0 | yes | — |
| St Andrews Rd: Thomson Memorial Park Trl - Suraty Ave | ATR_SPEED_VOLUME | 2025-06-03 | recent | 1337 | 08:00:00 (113) | -36783523#1 (pair) | 2.1 | yes | — |
| St Andrews Rd: Brimley Rd - Neapolitan Dr | ATR_SPEED_VOLUME | 2025-06-03 | recent | 1889 | 08:00:00 (167) | -36783644#1 (pair) | 2.5 | yes | — |
| Nelson St: Kinsmen Gt - Bellamy Rd N | ATR_SPEED_VOLUME | 2025-07-22 | recent | 1044 | 09:00:00 (51) | -35835702#2 (pair) | 2.6 | yes | — |
| Perivale Cres: Hague Park Trl - Dignam Crt | ATR_SPEED_VOLUME | 2025-07-22 | recent | 295.3 | 09:15:00 (13) | -25542116#7 (pair) | 2.0 | yes | — |
| Rossander Crt: Hague Park Trl - Bendale Blvd | ATR_SPEED_VOLUME | 2025-07-22 | recent | 133.7 | 08:00:00 (9) | 25542120#2 (pair) | 0.4 | yes | — |
| Thicketwood Dr: Savarin St - Providence St | ATR_SPEED_VOLUME | 2025-07-22 | recent | 127.7 | 09:15:00 (6) | -35798420#1 (pair) | 2.6 | yes | — |
| Thicketwood Dr: Providence St - Danforth Rd | ATR_SPEED_VOLUME | 2025-07-22 | recent | 364.7 | 08:00:00 (21) | -35798442#3 (pair) | 2.8 | yes | — |
| Amarillo Dr: Cedar Brae Blvd - Bellamy Rd N | ATR_SPEED_VOLUME | 2025-07-22 | recent | 361.3 | 08:00:00 (100) | -35798511#4 (pair) | 2.6 | yes | — |
| Greencrest Crct: Confederation Dr - Holmfirth Ter | ATR_SPEED_VOLUME | 2025-08-26 | recent | 3924.7 | 09:15:00 (174) | -36796016#5 (pair) | 0.8 | yes | — |
| Greenholm Crct: Hiscock Blvd - Wortham Dr | ATR_SPEED_VOLUME | 2025-08-26 | recent | 4826.3 | 08:30:00 (243) | 36795769#0 (pair) | 1.5 | yes | — |
| Greenbrae Crct: Sedgemount Dr - Walkway W of Abbeville and S of Six Nations | ATR_SPEED_VOLUME | 2025-08-26 | recent | 3928 | 09:15:00 (170) | 36784248#0 (pair) | 0.9 | yes | — |
| Greencedar Crct: Daphne Rd - Markham Rd | ATR_SPEED_VOLUME | 2025-08-26 | recent | 3972.3 | 09:15:00 (170) | 33635431#3 (pair) | 2.7 | yes | — |
| Lawrence Ave E: Bellamy Rd N - Greencedar Crct | ATR_SPEED_VOLUME | 2025-10-21 | recent | 31124 | 08:15:00 (1777) | 36797497#7 (pair) | 6.0 | yes | — |
| Glenda Rd: Lawndale Rd - Lochleven Dr | ATR_SPEED_VOLUME | 2025-10-21 | recent | 399 | 08:30:00 (33) | -548144835 (pair) | 2.4 | yes | — |
| Bellamy Rd N: Trudelle St - Porchester Dr | ATR_SPEED_VOLUME | 2025-10-21 | recent | 12414.7 | 08:00:00 (922) | -1445725777#1 (pair) | 0.6 | yes | — |
| Bellamy Rd N: Cedar Brae Blvd - Hague Park Trl | ATR_SPEED_VOLUME | 2025-10-21 | recent | 15759.3 | 08:15:00 (1267) | -33724739#1 (pair) | 4.3 | yes | — |
| Bellamy Rd N: Crusader St - Lawrence Ave E | ATR_SPEED_VOLUME | 2025-10-21 | recent | 15224.7 | 08:00:00 (1190) | -43329402#1 (pair) | 3.0 | yes | — |
| Eastpark Blvd: Orville Rd - Daphne Rd | ATR_SPEED_VOLUME | 2025-10-28 | recent | 2225 | 08:15:00 (199) | 27898844#6 (pair) | 1.2 | yes | — |
| Brockley Dr: Liam Foudy Crt - Akil Thomas Gdns | ATR_SPEED_VOLUME | 2025-11-18 | recent | 1264.3 | 08:15:00 (203) | 1246823329#3 (pair) | 0.9 | yes | — |
| Markham Rd: Cougar Crt - Dunelm St | ATR_SPEED_VOLUME | 2025-11-25 | recent | 23434 | 08:15:00 (1459) | 24488219 (pair) | 3.2 | yes | — |
| Galloway Rd: 185 Galloway Rd - Lawrence Ave E | ATR_SPEED_VOLUME | 2025-12-09 | recent | 4669.3 | 08:15:00 (366) | -445892457#14 (pair) | 0.9 | yes | — |
| Beachell St: Eglinton Ave E - Luella St | ATR_SPEED_VOLUME | 2026-01-20 | recent | 828.7 | 08:00:00 (71) | 22486538#0 (pair) | 1.3 | yes | — |
| Savarin St: Danforth Rd - Thicketwood Dr | ATR_SPEED_VOLUME | 2026-03-10 | recent | 486.3 | 08:00:00 (68) | -35798427#1 (pair) | 1.6 | yes | — |
| Greencedar Crct: Lawrence Ave E - Crusader St | ATR_SPEED_VOLUME | 2026-03-24 | recent | 3521.7 | 08:30:00 (235) | -33635431#0 (pair) | 2.8 | yes | — |
| Havenview Rd to Kentish Cres | ATR_SPEED_VOLUME | 2026-03-24 | recent | 1382.3 | 08:15:00 (239) | -36886085#1 (pair) | 2.2 | yes | — |
| Military Trl: 341 Military Trl - 351 Military Trl | ATR_SPEED_VOLUME | 2026-03-24 | recent | 1683.3 | 08:00:00 (179) | 498864116 (pair) | 1.1 | yes | — |
| Morningside Ave: Beath St - Morningside Park Trl | ATR_SPEED_VOLUME | 2026-03-24 | recent | 24869.3 | 08:00:00 (1595) | -14608667 (pair) | 3.9 | yes | — |
| Slan Ave: Spraywood Gt - Montavista St | ATR_SPEED_VOLUME | 2026-04-07 | recent | 1151 | 08:00:00 (114) | 36795847#12 (pair) | 1.9 | yes | — |
| Brimorton Dr: Camlac Pl - Amberdale Dr | ATR_SPEED_VOLUME | 2026-04-07 | recent | 5302.7 | 08:00:00 (470) | 36783512 (pair) | 2.8 | yes | — |
| Bellamy Rd N: Brimorton Dr - Northleigh Dr | ATR_SPEED_VOLUME | 2026-04-07 | recent | 17488 | 08:15:00 (1485) | -1288872291#2 (pair) | 3.5 | yes | — |
| Orton Park Rd: 250 Orton Park Rd - 371 Orton Park Rd | ATR_SPEED_VOLUME | 2026-04-07 | recent | 8105 | 08:15:00 (647) | 1484764425#0 (pair) | 2.1 | yes | — |
| Brimley Rd: Thomson Memorial Park Trl - Britwell Ave | ATR_SPEED_VOLUME | 2026-04-07 | recent | 26241 | 07:45:00 (1626) | -36789581#1 (pair) | 4.3 | yes | — |
| Military Trl: Cindy Nicholas Dr - The Meadoway | ATR_SPEED_VOLUME | 2026-04-21 | recent | 4303.3 | 07:45:00 (556) | 632963007#18 (pair) | 2.1 | yes | — |
| Coronation Dr: Darlingside Dr - Shoreview Dr | ATR_SPEED_VOLUME | 2026-05-05 | recent | 5896.7 | 08:00:00 (586) | 8162944#1 (pair) | 2.7 | yes | — |
| Markham Rd: Eastpark Blvd - Greencrest Crct | ATR_SPEED_VOLUME | 2026-05-05 | recent | 23784.7 | 08:15:00 (1485) | 36797533#0 (pair) | 3.8 | yes | — |
| Mason Rd: Glenda Rd - Adanac Dr | ATR_SPEED_VOLUME | 2026-05-05 | recent | 3225 | 08:15:00 (295) | 43328162#2 (pair) | 2.8 | yes | — |
| Ellesmere Rd: Gander Dr - Chancellor Dr | ATR_SPEED_VOLUME | 2026-05-12 | recent | 19861.3 | 08:00:00 (1302) | -36796637#3 (pair) | 3.8 | yes | — |
| Midland Ave: Lord Roberts Dr - Wainfleet Rd | ATR_SPEED_VOLUME | 2026-05-12 | recent | 19872 | 08:00:00 (1394) | 232196664#0 (pair) | 4.7 | yes | — |
| Birkdale Rd: Birkdale Ravine Trl - Edgewood Park Trl | ATR_SPEED_VOLUME | 2026-06-23 | recent | 1236 | 08:15:00 (99) | -1334846254#1 (pair) | 2.8 | yes | — |
| Applefield Dr: Brimley Rd - Tordale Cres | ATR_SPEED_VOLUME | 2026-06-23 | recent | 481 | 07:45:00 (28) | -36783573#1 (pair) | 2.5 | yes | — |
| Applefield Dr: Tordale Cres - Birkdale Ravine Trl | ATR_SPEED_VOLUME | 2026-06-23 | recent | 360.3 | 08:30:00 (20) | -36783529#3 (pair) | 1.8 | yes | — |
| Applefield Dr: Waterfield Dr - Tordale Cres | ATR_SPEED_VOLUME | 2026-06-23 | recent | 389.3 | 08:30:00 (26) | 36783650#0 (pair) | 1.6 | yes | — |
| Applefield Dr: Birkdale Ravine Trl - Brimley Rd | ATR_SPEED_VOLUME | 2026-06-23 | recent | 632.7 | 08:15:00 (44) | 36783628#0 (pair) | 0.6 | yes | — |
| Birkdale Rd to Medway Cres | ATR_SPEED_VOLUME | 2026-06-23 | recent | 1160.7 | 08:15:00 (90) | -36783638#1 (pair) | 2.2 | yes | — |
| Progress Ave: Cosentino Dr - Schick Crt | ATR_VOLUME | 2015-03-31 | aging | 7872.3 | 09:15:00 (397) | 50887299#3 (pair) | 3.7 | yes | — |
| Progress Ave: Midland Ave - Cosentino Dr | ATR_VOLUME | 2015-03-31 | aging | 8489 | 08:00:00 (714) | 50887299#14 (pair) | 4.6 | yes | — |
| Progress Ave: Borough Dr - Hwy 401 Collectors E / Progress Av Ramp | ATR_VOLUME | 2015-03-31 | aging | 14945.3 | 08:45:00 (1188) | 252976984#0 (pair) | 9.2 | yes | — |
| Hwy 401 Collectors E / Progress Av Ramp | ATR_VOLUME | 2015-03-31 | aging | 23545.7 | 08:00:00 (1406) | 235236372 (pair) | 8.4 | yes | — |
| Progress Ave: Schick Crt - Brimley Rd | ATR_VOLUME | 2015-03-31 | aging | 17089.7 | 07:45:00 (1199) | 50887299#0 (pair) | 3.5 | yes | — |
| Progress Ave: Brimley Rd - Borough Dr | ATR_VOLUME | 2015-03-31 | aging | 10691.7 | 07:45:00 (704) | 375407849#0 (pair) | 5.8 | yes | — |
| Progress Ave: Grangeway Ave - Bellamy Rd N | ATR_VOLUME | 2015-03-31 | aging | 7645.7 | 08:00:00 (398) | -43308452#10 (pair) | 3.9 | yes | — |
| Corporate Dr: Toyota Pl - Progress Ave | ATR_VOLUME | 2015-03-31 | aging | 11512 | 07:45:00 (1251) | -36784858#22 (pair) | 8.0 | yes | — |
| Progress Ave: Corporate Dr - McCowan Rd S / Progress Ave Ramp | ATR_VOLUME | 2015-03-31 | aging | 18487.7 | 08:30:00 (1359) | -50887389#1 (pair) | 4.6 | yes | — |
| Progress Ave to McCowan Rd S / Progress Ave Ramp | ATR_VOLUME | 2015-03-31 | aging | 4647.3 | 07:30:00 (430) | 27121806#1 (pair) | 39.6 | yes | — |
| Progress Ave: Hwy 401 Collectors E / Progress Av Ramp - Corporate Dr | ATR_VOLUME | 2015-03-31 | aging | 23358.7 | 08:15:00 (1625) | 252976666#0 (pair) | 7.2 | yes | — |
| Progress Ave to Grangeway Ave | ATR_VOLUME | 2015-03-31 | aging | 5554.3 | 08:00:00 (369) | -26296427#1 (pair) | 16.9 | yes | — |
| Progress Ave: Milner Business Crt - Milner Ave | ATR_VOLUME | 2015-03-31 | aging | 7180.7 | 08:15:00 (363) | -37236802#1 (pair) | 4.5 | yes | — |
| Progress Ave: Estate Dr - Markham Rd | ATR_VOLUME | 2015-03-31 | aging | 13008.7 | 08:15:00 (861) | 37237445#0 (pair) | 6.6 | yes | — |
| Progress Ave: Markham Rd - Progress Ave N / Hwy 401 Collectors E Ramp | ATR_VOLUME | 2015-03-31 | aging | 28803.3 | 08:00:00 (2908) | 607539909 (pair) | 0.9 | yes | — |
| Danforth Rd: Tansley Ave - Carslake Cres | ATR_SPEED_VOLUME | 2015-09-09 | aging | 15400 | 08:15:00 (1167) | 129726925#13 (pair) | 2.9 | yes | — |
| McCowan Rd: Pitfield Rd - Sheppard Ave E | ATR_VOLUME | 2016-01-30 | aging | 22660.7 | 08:00:00 (1434) | 36921176#0 (pair) | 7.1 | yes | — |
| McCowan Rd: Lawrence Ave E - Benleigh Dr | ATR_VOLUME | 2016-05-30 | aging | 16455.6 | 08:30:00 (1230) | -36785025 (pair) | 3.2 | yes | — |
| Morningside Ave: Ellesmere Rd - Military Trl | ATR_VOLUME | 2016-07-04 | aging | 14299.3 | 08:00:00 (1250) | 1264417462#0 (pair) | 12.9 | yes | — |
| Morningside Ave: Lawrence Ave E - Kingston Rd | ATR_VOLUME | 2016-07-04 | aging | 7412.7 | 08:00:00 (682) | -36804807#3 (pair) | 5.0 | yes | — |
| Orton Park Rd to 250 Orton Park Rd | ATR_SPEED_VOLUME | 2017-04-26 | aging | 6937 | 08:00:00 (491) | 1484764425#0 (pair) | 2.2 | yes | — |
| Orton Park Rd: 400 Orton Park Rd - 371 Orton Park Rd | ATR_SPEED_VOLUME | 2017-04-26 | aging | 7054 | 08:00:00 (511) | 36795777 (pair) | 2.5 | yes | — |
| McCowan Rd: Hollyhedge Dr - Lawrence Ave E | ATR_VOLUME | 2017-05-09 | aging | 13592.3 | 08:15:00 (921) | 129725698#3 (pair) | 2.8 | yes | — |
| Collinsgrove Rd: 55 Collinsgrove Rd - Kingston Rd | ATR_SPEED_VOLUME | 2017-07-13 | aging | 2688 | 08:15:00 (132) | 5025496#0 (pair) | 1.5 | yes | — |
| Painted Post Dr: Abbeville Rd - Sharbot Ave | ATR_SPEED_VOLUME | 2017-08-23 | aging | 1039 | 09:15:00 (55) | -36784316 (pair) | 2.1 | yes | — |
| Benleigh Dr to Benorama Cres | ATR_SPEED_VOLUME | 2017-08-23 | aging | 784 | 08:00:00 (47) | -36784193 (pair) | 2.5 | yes | — |
| Collinsgrove Rd: 25 Collinsgrove Rd - 41 Collinsgrove Rd | ATR_SPEED_VOLUME | 2017-10-25 | aging | 2816 | 08:15:00 (178) | -5025496#17 (pair) | 2.4 | yes | — |
| Collinsgrove Rd: Lawrence Ave E - 25 Collinsgrove Rd | ATR_SPEED_VOLUME | 2017-10-25 | aging | 3324 | 08:30:00 (192) | -5025496#17 (pair) | 2.4 | yes | — |
| Ellesmere Rd: Grangeway Ave - Parkington Cres | ATR_SPEED_VOLUME | 2017-10-25 | aging | 24177 | 08:00:00 (1494) | 1382966530#0 (pair) | 4.1 | yes | — |
| Military Trl: Conlins Rd - Gladys Rd | ATR_SPEED_VOLUME | 2018-02-27 | aging | 6831.3 | 08:00:00 (609) | 227818179#2 (pair) | 2.7 | yes | — |
| Military Trl: 1275 Military Trl - Conlins Rd | ATR_SPEED_VOLUME | 2018-02-27 | aging | 8731.7 | 08:00:00 (660) | -227818179#1 (pair) | 2.8 | yes | — |
| Military Trl: Pan Am Dr - Ellesmere Rd | ATR_SPEED_VOLUME | 2018-02-27 | aging | 5532.3 | 07:45:00 (377) | 227679320 (pair) | 2.5 | yes | — |
| Military Trl: Morningside Ave - Pan Am Dr | ATR_SPEED_VOLUME | 2018-02-27 | aging | 4938.7 | 08:00:00 (422) | -220546961 (pair) | 1.5 | yes | — |
| Tara Ave: Medina Cres - Fitzgibbon Ave | ATR_SPEED_VOLUME | 2018-04-10 | aging | 296 | 08:30:00 (23) | 35835552#0 (pair) | 1.0 | yes | — |
| Orton Park Rd: Ladysbridge Dr - Brimorton Dr | ATR_SPEED_VOLUME | 2018-06-26 | aging | 6747 | 08:00:00 (447) | -36795859#3 (pair) | 2.5 | yes | — |
| Military Trl: Morningside Park Trl - Highcastle Rd | ATR_SPEED_VOLUME | 2018-09-12 | aging | 3244.5 | 07:30:00 (191) | 36861172#0 (pair) | 1.6 | yes | — |
| Neilson Rd: Gatineau Hydro Corridor Trl - Military Trl | ATR_VOLUME | 2018-11-24 | aging | 7496.3 | 08:15:00 (571) | 632963004 (pair) | 4.4 | yes | — |
| Neilson Rd: Military Trl - Oakmeadow Blvd | ATR_VOLUME | 2018-11-24 | aging | 8748.7 | 08:00:00 (921) | -86810968 (pair) | 1.7 | yes | — |
| Milner Ave: McCowan Rd - Mid-Dominion Acres | ATR_SPEED_VOLUME | 2018-12-05 | aging | 8003.5 | 07:15:00 (728) | -23799280#47 (pair) | 3.1 | yes | — |
| Dearham Wood: Wooster Wood - Lausanne Cres | ATR_SPEED_VOLUME | 2018-12-18 | aging | 2001 | 08:00:00 (230) | -36858942#1 (pair) | 1.4 | yes | — |
| Morningside Ave: Tefft Rd - Warnsworth St | ATR_SPEED_VOLUME | 2019-01-09 | aging | 21881 | 08:00:00 (1454) | 1326385906#0 (pair) | 4.6 | yes | — |
| Morningside Ave: Morningside Park Trl - Ellesmere Rd | ATR_SPEED_VOLUME | 2019-01-09 | aging | 24588 | 08:00:00 (1787) | 228429615 (pair) | 2.0 | yes | — |
| Borough Dr to Town Centre Crt (id: 107848) | ATR_VOLUME | 2019-03-05 | aging | 5115.5 | 08:00:00 (475) | 291406212 (pair) | 4.5 | yes | — |
| Morningside Ave: Ling Rd - Lawrence Ave E | ATR_SPEED_VOLUME | 2019-03-05 | aging | 12749.7 | 08:00:00 (948) | 25373638#4 (pair) | 3.9 | yes | — |
| Brimley Rd: Gully Dr - Knob Hill Park Trl | ATR_SPEED_VOLUME | 2019-04-03 | aging | 22742 | 08:00:00 (1703) | -44705953#3 (pair) | 4.4 | yes | — |
| Brimley Rd: Walkway S of Deerfield and W of Brimley - Seminole Ave | ATR_SPEED_VOLUME | 2019-04-03 | aging | 22742 | 08:00:00 (1703) | -44705953#3 (pair) | 4.4 | yes | — |
| Midland Ave: Tara Ave - Romulus Dr | ATR_SPEED_VOLUME | 2019-04-16 | aging | 10840.5 | 08:00:00 (909) | 1384498769#1 (pair) | 4.0 | yes | — |
| Lord Roberts Dr: Wainfleet Rd - Tremely Cres | ATR_SPEED_VOLUME | 2019-04-16 | aging | 632.5 | 08:00:00 (117) | 35835543#0 (pair) | 0.1 | yes | — |
| Nelson St: Bellamy Rd N - Farmbrook Rd | ATR_SPEED_VOLUME | 2019-04-16 | aging | 1736 | 08:00:00 (182) | 35835689#0 (pair) | 2.7 | yes | — |
| Lawrence Ave E: Rushley Dr - Brimley Rd | ATR_SPEED_VOLUME | 2019-04-16 | aging | 35198.5 | 08:15:00 (2349) | 437221764#9 (pair) | 5.3 | yes | — |
| Haileybury Dr: Deerfield Rd - Penetang Cres | ATR_SPEED_VOLUME | 2019-04-16 | aging | 195.5 | 08:30:00 (12) | 35835608 (pair) | 2.4 | yes | — |
| Bernadine St: Cora Cres - Doerr Rd | ATR_SPEED_VOLUME | 2019-04-17 | aging | 1345.5 | 07:45:00 (164) | 36783510#0 (pair) | 0.6 | yes | — |
| Dorcot Ave: Highbrook Dr - Munson Cres | ATR_SPEED_VOLUME | 2019-04-17 | aging | 325 | 08:00:00 (99) | 36783608#0 (pair) | 1.4 | yes | — |
| Midland Ave: Midwest Rd - Brockley Dr | ATR_SPEED_VOLUME | 2019-04-17 | aging | 26774.5 | 08:15:00 (2012) | -1352299701 (pair) | 4.3 | yes | — |
| Markanna Dr: Coltbridge Crt - Markham Rd | ATR_SPEED_VOLUME | 2019-04-24 | aging | 1378.5 | 08:15:00 (169) | -35798483#4 (pair) | 2.1 | yes | — |
| Dorcot Ave: Birkdale Rd - Lyon Heights Rd | ATR_SPEED_VOLUME | 2019-06-04 | aging | 2128.3 | 08:00:00 (201) | 36783515#0 (pair) | 0.9 | yes | — |
| Brimorton Dr: Jackmuir Cres - Neapolitan Dr | ATR_SPEED_VOLUME | 2019-06-04 | aging | 5077.7 | 07:45:00 (502) | 36783672 (pair) | 2.3 | yes | — |
| Scarborough Golf Club Rd: Painted Post Dr - Newark Rd | ATR_SPEED_VOLUME | 2019-06-05 | aging | 12830 | 08:00:00 (926) | -36796043#1 (pair) | 3.9 | yes | — |
| Seminole Ave: Tansley Ave - Glos Ave | ATR_SPEED_VOLUME | 2019-06-25 | aging | 1787.3 | 07:45:00 (234) | -35835643#4 (pair) | 2.3 | yes | — |
| Windover Dr: Shoredale Dr - Susan St | ATR_SPEED_VOLUME | 2019-06-25 | aging | 616.3 | 08:30:00 (89) | 36795875#1 (pair) | 1.5 | yes | — |
| Markham Rd: Greenholm Crct - Rochman Blvd | ATR_SPEED_VOLUME | 2019-09-18 | aging | 25109.5 | 08:15:00 (1363) | 1288863200 (pair) | 1.8 | yes | — |
| Ellesmere Rd: Oakley Blvd - Birkdale Rd | ATR_SPEED_VOLUME | 2019-09-18 | aging | 24830 | 08:15:00 (1629) | -448500603#6 (pair) | 4.6 | yes | — |
| Danforth Rd: Elmdon Crt - Mackinac Cres | ATR_SPEED_VOLUME | 2019-09-18 | aging | 20706 | 07:45:00 (1375) | 129726925#8 (pair) | 3.8 | yes | — |
| Brimley Rd: Deerfield Rd - Largo Lane | ATR_SPEED_VOLUME | 2019-09-18 | aging | 21076 | 08:15:00 (1422) | -44705953#6 (pair) | 4.7 | yes | — |
| Morningside Ave: Warnsworth St - Beath St | ATR_SPEED_VOLUME | 2019-09-18 | aging | 23094 | 07:45:00 (1419) | -632741895#1 (pair) | 3.0 | yes | — |
| McCowan Rd: Huronia Gt - Hurley Cres | ATR_SPEED_VOLUME | 2019-09-18 | aging | 27034 | 08:00:00 (1835) | -36790143#1 (pair) | 3.3 | yes | — |
| Eglinton Ave E: Markham Rd - Cedar Dr | ATR_VOLUME | 2019-09-19 | aging | 8895 | 08:00:00 (770) | -37229661#3 (pair) | 5.3 | yes | — |
| Eglinton Ave E: Centre St - Markham Rd | ATR_VOLUME | 2019-09-19 | aging | 11749.3 | 08:30:00 (670) | 37229659#6 (pair) | 7.0 | yes | — |
| Tefft Rd: Morningside Ave - Amiens Rd | ATR_SPEED_VOLUME | 2019-10-22 | aging | 508.5 | 08:00:00 (74) | 5560185#0 (pair) | 1.5 | yes | — |
| Havenview Rd: Kentish Cres - Lockdare St | ATR_SPEED_VOLUME | 2019-10-22 | aging | 1253 | 08:15:00 (178) | -36886079 (pair) | 2.4 | yes | — |
| McCowan Rd: Blue Lagoon Crt - Fred Bland Cres | ATR_SPEED_VOLUME | 2019-10-29 | aging | 1262.7 | 08:00:00 (185) | 22486527#3 (pair) | 2.7 | yes | — |
| McCowan Rd: Fred Bland Cres - West Highland Creek Trl | ATR_SPEED_VOLUME | 2019-10-29 | aging | 741.7 | 08:00:00 (145) | -22486527#2 (pair) | 2.4 | yes | — |
| Brimorton Dr: Bromton Dr - Camlac Pl | ATR_SPEED_VOLUME | 2019-10-30 | aging | 4810 | 07:45:00 (521) | -36783605 (pair) | 2.5 | yes | — |
| Brimorton Dr: Doerr Rd - Jackmuir Cres | ATR_SPEED_VOLUME | 2019-10-30 | aging | 5166 | 07:45:00 (546) | 36783549#0 (pair) | 1.5 | yes | — |
| Cedar Brae Blvd: Nelson St - Amarillo Dr | ATR_SPEED_VOLUME | 2019-11-26 | aging | 1002.3 | 08:15:00 (151) | 37229618 (pair) | 1.8 | yes | — |
| Conlins Rd to Challenger Crt | ATR_SPEED_VOLUME | 2019-11-26 | aging | 5306 | 08:00:00 (452) | -36854676#2 (pair) | 2.7 | yes | — |
| Hwy 401 Collectors E / Markham Rd N Ramp | ATR_VOLUME | 1994-01-26 | stale | 13624 | 08:00:00 (0) | 8162195#0 (pair) | 5.4 | yes | — |
| Mccowan Rd S / Hwy 401 Collectors W Ramp | ATR_VOLUME | 1994-01-31 | stale | 13238 | 09:15:00 (768) | 4934537#0 (pair) | 0.1 | yes | — |
| Hwy 401 Collectors E / Markham Rd S Ramp | ATR_VOLUME | 1994-01-31 | stale | 9823 | 09:15:00 (501) | 8162196#0 (pair) | 3.6 | yes | — |
| Mccowan Rd N / Hwy 401 Collectors W Ramp | ATR_VOLUME | 1994-01-31 | stale | 10404 | 09:15:00 (553) | 4934562#0 (pair) | 2.3 | yes | — |
| Mccowan Rd N / Hwy 401 Collectors E Ramp | ATR_VOLUME | 1994-01-31 | stale | 5135 | 09:15:00 (201) | 4934528#0 (pair) | 0.8 | yes | — |
| Mccowan Rd S / Hwy 401 Collectors E Ramp | ATR_VOLUME | 1994-02-10 | stale | 3025 | 08:00:00 (204) | 4934513#0 (pair) | 1.5 | yes | — |
| Hwy 401 Collectors W / Mccowan Rd Ramp | ATR_VOLUME | 1994-02-24 | stale | 12727 | 07:30:00 (0) | 1273894815 (pair) | 0.4 | yes | — |
| Galloway Rd: 141 Galloway Rd - Kingston Rd | ATR_VOLUME | 1995-03-01 | stale | 6030 | 08:00:00 (614) | -1490021005#2 (pair) | 2.1 | yes | — |
| Poplar Rd: 4315 Kingston Rd - Kingston Rd | ATR_VOLUME | 1995-03-02 | stale | 2782 | 08:15:00 (230) | 500275922#3 (pair) | 2.6 | yes | — |
| Markham Rd S / Hwy 401 Collectors E Ramp (id: 106706) | ATR_VOLUME | 1995-12-04 | stale | 3438 | 09:00:00 (192) | 5337071#0 (pair) | 1.5 | yes | — |
| Markham Rd N / Hwy 401 Collectors E Ramp | ATR_VOLUME | 1995-12-04 | stale | 6017 | 08:30:00 (244) | 5281815#0 (pair) | 2.6 | yes | — |
| Hwy 401 Collectors W / Markham Rd Ramp | ATR_VOLUME | 1995-12-04 | stale | 6177 | 07:15:00 (952) | 8162124#0 (pair) | 2.4 | yes | — |
| Markham Rd N / Hwy 401 Collectors W Ramp (id: 106516) | ATR_VOLUME | 1995-12-04 | stale | 11956 | 06:45:00 (931) | 5337080#0 (pair) | 2.3 | yes | — |
| Markham Rd S / Hwy 401 Collectors W Ramp | ATR_VOLUME | 1996-03-12 | stale | 16166 | 07:45:00 (1269) | 5337079#0 (pair) | 3.4 | yes | — |
| Brimley Rd: Brimley Rd N / Hwy 401 Collectors W Ramp - Grittani Lane | ATR_VOLUME | 1996-07-23 | stale | 8334 | 08:00:00 (593) | 23799505#0 (pair) | 3.6 | yes | — |
| Hwy 401 Collectors E / Brimley S Ramp | ATR_VOLUME | 1996-07-23 | stale | 7563 | 08:00:00 (522) | 36921405 (pair) | 0.3 | yes | — |
| Milner Ave: Milner Business Crt - Parkborough Blvd | ATR_VOLUME | 1997-02-27 | stale | 9187.8 | 07:45:00 (1193) | 33542820#2 (pair) | 7.1 | yes | — |
| Stoneton Dr: Lynnbrook Dr - Ellesmere Rd | ATR_VOLUME | 2001-10-30 | stale | 515 | 09:15:00 (35) | 36784317#0 (pair) | 2.9 | yes | — |
| Scunthorpe Rd: Milner Ave - Invergordon Ave | ATR_VOLUME | 2001-10-30 | stale | 5373 | 09:15:00 (437) | -36886099#3 (pair) | 2.3 | yes | — |
| Pitfield Rd: Keyworth Trl - McCowan Rd | ATR_VOLUME | 2001-10-30 | stale | 6616.7 | 08:15:00 (480) | -36921203#4 (pair) | 2.4 | yes | — |
| Pitfield Rd: Fulham St - Brimley Rd | ATR_VOLUME | 2001-10-30 | stale | 1724.3 | 08:00:00 (216) | 36548460#0 (pair) | 2.6 | yes | — |
| Packard Blvd: Gable Pl - Ellesmere Rd | ATR_VOLUME | 2001-10-30 | stale | 1056 | 08:45:00 (67) | 36783554#0 (pair) | 2.9 | yes | — |
| McCowan Rd S / Progress Ave Ramp | ATR_VOLUME | 2001-10-30 | stale | 11242 | 09:00:00 (820) | 37192025#0-AddedOffRampEdge (pair) | 0.3 | yes | — |
| Invergordon Ave: McCowan Rd - Tineta Cres | ATR_VOLUME | 2001-10-30 | stale | 7151.3 | 08:45:00 (612) | 36886072#0 (pair) | 1.7 | yes | — |
| Corporate Dr / Hwy 401 Collectors E Ramp | ATR_VOLUME | 2001-10-30 | stale | 8539.7 | 09:15:00 (199) | 4934532#0 (pair) | 1.4 | yes | — |
| Prince Philip Blvd: Bournville Dr - Avonmore Sq | ATR_SPEED_VOLUME | 2003-06-10 | stale | 2290 | 06:30:00 (134) | -35303711#1 (pair) | 2.5 | yes | — |
| Gladys Rd: Military Trl - Ellesmere Rd | ATR_SPEED_VOLUME | 2003-07-05 | stale | 309 | — | -43921800#1 (pair) | 1.6 | yes | — |
| Sylvan Ave: South Marine Dr - Prince Philip Blvd | ATR_SPEED_VOLUME | 2003-10-22 | stale | 1308 | 07:45:00 (174) | 35303757#0 (pair) | 1.5 | yes | — |
| Pitfield Rd: Terryhill Cres - Cleethorpes Blvd | ATR_SPEED_VOLUME | 2003-11-26 | stale | 3983 | 07:45:00 (406) | 36548449#4 (pair) | 0.6 | yes | — |
| Morningside Ave: Danzig St - Ling Rd | ATR_VOLUME | 2003-12-04 | stale | 6423 | 08:00:00 (560) | -25373638#3 (pair) | 4.7 | yes | — |
| Kingston Rd: Fred Johnson Park Trl - Muir Dr | ATR_SPEED_VOLUME | 2004-04-01 | stale | 17630 | 07:15:00 (2379) | 306061212 (pair) | 7.1 | yes | — |
| Farmbrook Rd: Cheyenne Dr - Bellamy Rd N | ATR_SPEED_VOLUME | 2004-04-15 | stale | 662 | 07:45:00 (76) | 35835679#0 (pair) | 2.6 | yes | — |
| Seminole Ave: Mackinac Cres - Danforth Rd | ATR_SPEED_VOLUME | 2004-09-22 | stale | 1276 | 07:45:00 (145) | -35835643#11 (pair) | 2.6 | yes | — |
| Bellamy Rd N: Amarillo Dr - Braeburn Blvd | ATR_SPEED_VOLUME | 2004-11-03 | stale | 11512 | 07:45:00 (1021) | 43326406#8 (pair) | 4.1 | yes | — |
| Galloway Rd: Dearham Wood - Chantrey Crt | ATR_SPEED_VOLUME | 2004-11-03 | stale | 2257 | 07:45:00 (245) | -1302266980#1 (pair) | 1.4 | yes | — |
| Oakmeadow Blvd: Grovenest Dr - Stonefield Cres | ATR_SPEED_VOLUME | 2004-11-03 | stale | 1153 | 08:00:00 (133) | 36861120#11 (pair) | 2.6 | yes | — |
| Citadel Dr: Stansbury Cres - Bimbrok Rd | ATR_SPEED_VOLUME | 2004-12-01 | stale | 1300 | 08:15:00 (131) | 35796836 (pair) | 0.8 | yes | — |
| Stansbury Cres to Citadel Dr (id: 110602) | ATR_SPEED_VOLUME | 2004-12-01 | stale | 1193 | 08:15:00 (114) | -35796885#2 (pair) | 0.0 | yes | — |
| Greenbrae Crct: Walkway W of Abbeville and S of Six Nations - Markham Rd | ATR_SPEED_VOLUME | 2005-05-31 | stale | 1897 | 08:30:00 (163) | -36784288#2 (pair) | 0.8 | yes | — |
| Greencrest Crct: Markham Rd - Confederation Dr | ATR_SPEED_VOLUME | 2005-05-31 | stale | 6717.7 | 06:30:00 (527) | 36796049#1 (pair) | 1.3 | yes | — |
| Ellesmere Rd: Calverley Trl - Watson St | ATR_SPEED_VOLUME | 2005-06-23 | stale | 10451 | 07:15:00 (1404) | 36855333#0 (pair) | 3.8 | yes | — |
| Brinloor Blvd: P Mackie Pub Gt - Service Rd | ATR_SPEED_VOLUME | 2005-10-05 | stale | 479 | 07:45:00 (66) | -35798519 (pair) | 2.5 | yes | — |
| Brimorton Dr: Woolwick Dr - Bellamy Rd N | ATR_VOLUME | 2005-10-25 | stale | 2980 | 08:45:00 (199) | 36784270 (pair) | 0.1 | yes | — |
| Celeste Dr to Glory Cres | ATR_SPEED_VOLUME | 2005-11-02 | stale | 1038 | 07:15:00 (126) | -36859108 (pair) | 2.0 | yes | — |
| Military Trl: Gatineau Hydro Corridor Trl - Morningside Park Trl | ATR_VOLUME | 2005-11-29 | stale | 3743 | 08:00:00 (731) | -36795824 (pair) | 2.1 | yes | — |
| Military Trl: Scenic Hill Crt - Old Kingston Rd | ATR_VOLUME | 2005-11-29 | stale | 3819.7 | 08:45:00 (210) | 227818179#2 (pair) | 44.4 | yes | — |
| Merkley Sq to Mid Pines Rd | ATR_SPEED_VOLUME | 2005-11-30 | stale | 205 | 08:00:00 (21) | 36795837#5 (pair) | 0.7 | yes | — |
| Scarborough Golf Club Rd: Slan Ave - Painted Post Dr | ATR_SPEED_VOLUME | 2005-12-07 | stale | 10841 | 08:00:00 (848) | -36796043#0 (pair) | 4.3 | yes | — |
| Meldazy Dr: Manorwood Rd - McCowan Rd | ATR_SPEED_VOLUME | 2005-12-20 | stale | 189 | 09:00:00 (19) | 36783589#0 (pair) | 2.5 | yes | — |
| Manse Rd: Mansewood Gdns - Lawrence Ave E | ATR_VOLUME | 2006-03-07 | stale | 5991 | 06:30:00 (358) | -1191384224#1 (pair) | 28.7 | yes | — |
| Hiscock Blvd: Grassington Cres - Barlow Rd | ATR_SPEED_VOLUME | 2006-03-21 | stale | 1034.5 | 08:00:00 (87) | -36795763#25 (pair) | 0.7 | yes | — |
| Greenholm Crct: Wortham Dr - Markham Rd | ATR_SPEED_VOLUME | 2006-07-19 | stale | 3683 | 07:45:00 (210) | -36795828#2 (pair) | 0.5 | yes | — |
| Galloway Rd: Camps Lane - Weir Cres | ATR_SPEED_VOLUME | 2006-09-13 | stale | 1487 | 07:45:00 (210) | -184514833#1 (pair) | 1.9 | yes | — |
| Rodda Blvd: 10 Rodda Blvd - Westcroft Dr | ATR_SPEED_VOLUME | 2006-09-13 | stale | 1240.5 | 07:45:00 (121) | 1492452926#0 (pair) | 1.2 | yes | — |
| Weir Cres: Westcroft Dr - Silvertip Cres | ATR_SPEED_VOLUME | 2006-09-13 | stale | 281.5 | 08:00:00 (30) | -36859236#4 (pair) | 2.3 | yes | — |
| Mason Rd: Stanland Dr - Knowlton Dr | ATR_SPEED_VOLUME | 2006-09-21 | stale | 2117 | 08:00:00 (192) | -43328162#1 (pair) | 2.8 | yes | — |
| Lawrence Ave E (id: 109936) | ATR_SPEED_VOLUME | 2006-09-21 | stale | 881 | 07:45:00 (69) | 39206806 (pair) | 6.8 | yes | — |
| Lawrence Ave E to Prudential Dr (id: 109937) | ATR_SPEED_VOLUME | 2006-09-21 | stale | 1049 | 07:45:00 (77) | 129705856#0 (pair) | 1.2 | yes | — |
| Milner Ave: Novopharm Crt - Dailing Gt | ATR_SPEED_VOLUME | 2006-11-22 | stale | 12498 | 07:30:00 (1486) | 35349330#0 (pair) | 30.8 | yes | — |
| Slan Ave: Greenock Ave - Spraywood Gt | ATR_SPEED_VOLUME | 2007-01-24 | stale | 1171 | 07:45:00 (156) | 36795847#7 (pair) | 1.1 | yes | — |
| Grace St: Torrance Rd - Cedar Brae Blvd | ATR_SPEED_VOLUME | 2007-02-15 | stale | 861 | 08:00:00 (92) | 35798422#0 (pair) | 2.0 | yes | — |
| Susan St: Windover Dr - Lawrence Ave E | ATR_SPEED_VOLUME | 2007-04-25 | stale | 1685 | 08:00:00 (198) | -36795834#8 (pair) | 2.0 | yes | — |
| Payzac Ave: Dunera Ave - Emcarr Dr | ATR_SPEED_VOLUME | 2007-04-26 | stale | 634 | 08:30:00 (51) | -36859060 (pair) | 2.3 | yes | — |
| Scranton Rd: Markham Rd - Hiscock Blvd | ATR_SPEED_VOLUME | 2007-05-15 | stale | 1159 | 07:45:00 (83) | 36795878#0 (pair) | 1.4 | yes | — |
| Rushley Dr: Lawrence Ave E - Britwell Ave | ATR_VOLUME | 2007-06-05 | stale | 1586.3 | 08:15:00 (133) | -36783626#1 (pair) | 2.4 | yes | — |
| Birkdale Rd: Dorcot Ave - Freeborn Cres | ATR_VOLUME | 2007-06-05 | stale | 1252.7 | 08:00:00 (122) | -36783531#2 (pair) | 2.9 | yes | — |
| Borough Dr: Progress Ave - Triton Rd | ATR_VOLUME | 2007-06-05 | stale | 2839 | 08:45:00 (226) | 31876575 (pair) | 6.1 | yes | — |
| Triton Rd: Brimley Rd - Borough Dr | ATR_VOLUME | 2007-06-05 | stale | 10568 | 09:15:00 (487) | 282954485#0 (pair) | 5.5 | yes | — |
| Westlake Rd: Kingston Rd - Livingston Rd | ATR_VOLUME | 2007-06-05 | stale | 1545 | 08:15:00 (94) | 36858786#0 (pair) | 0.0 | yes | — |
| Bankwell Ave: Brimorton Dr - Scarborough Golf Club Rd | ATR_VOLUME | 2007-06-05 | stale | 723.7 | 08:00:00 (86) | -36796021#2 (pair) | 1.5 | yes | — |
| Treewood St: Tiller Lane - Brockley Dr | ATR_VOLUME | 2007-06-05 | stale | 1513.3 | 08:15:00 (122) | -36783686#5 (pair) | 2.5 | yes | — |
| Bethune Blvd: Hill Cres - Bethune Park Trl | ATR_VOLUME | 2007-06-05 | stale | 949.3 | 08:00:00 (73) | -35303769#1 (pair) | 2.8 | yes | — |
| Borough Approach E: Ellesmere Rd - Borough Dr | ATR_VOLUME | 2007-06-05 | stale | 2483.7 | 08:00:00 (197) | 287421094#0 (pair) | 4.7 | yes | — |
| Borough Approach W: Ellesmere Rd - Borough Dr | ATR_VOLUME | 2007-06-05 | stale | 1641 | 08:00:00 (134) | 186587456#0 (pair) | 4.7 | yes | — |
| Pitfield Rd: Brimley Rd - Terryhill Cres | ATR_VOLUME | 2007-06-28 | stale | 4050 | 07:45:00 (217) | 36548449#0 (pair) | 1.3 | yes | — |
| Rossander Crt: Bendale Blvd - Perivale Cres | ATR_SPEED_VOLUME | 2007-09-04 | stale | 454.5 | 08:45:00 (31) | 25542120#0 (pair) | 0.1 | yes | — |
| Dolly Varden Blvd: Confederation Park Trl - Ellesmere Rd | ATR_VOLUME | 2007-09-25 | stale | 1728.7 | 08:15:00 (125) | -36784243#8 (pair) | 1.5 | yes | — |
| Muir Dr: Service Rd - Bethune Blvd | ATR_VOLUME | 2007-09-25 | stale | 712.7 | 08:00:00 (87) | -35303750 (pair) | 0.6 | yes | — |
| Omni Dr: Brimley Rd - Borough Dr | ATR_VOLUME | 2007-09-25 | stale | 6816.7 | 08:15:00 (571) | 27121501#0 (pair) | 5.9 | yes | — |
| Packard Blvd: Stanwell Dr - Saratoga Dr | ATR_VOLUME | 2007-09-25 | stale | 1134 | 08:15:00 (114) | -36783536#2 (pair) | 1.0 | yes | — |
| Parkington Cres: Earlthorpe Cres - Ellesmere Rd | ATR_VOLUME | 2007-09-25 | stale | 921.7 | 08:30:00 (74) | -36784280#2 (pair) | 2.8 | yes | — |
| Dunelm St: Markham Rd - Cedar Dr | ATR_VOLUME | 2007-09-25 | stale | 2461.7 | 09:15:00 (312) | 25431434#0 (pair) | 2.7 | yes | — |
| Production Dr to Progress Ave | ATR_VOLUME | 2007-09-25 | stale | 1191 | 08:00:00 (91) | 27291651#0 (pair) | 2.7 | yes | — |
| Cumber Ave: Tivoli Crt - Morna Ave | ATR_VOLUME | 2007-09-25 | stale | 1896 | 08:15:00 (166) | 36858947#0 (pair) | 2.1 | yes | — |
| Corporate Dr to Lee Centre Dr | ATR_VOLUME | 2007-09-25 | stale | 15798.7 | 08:30:00 (1075) | -374196659#3 (pair) | 3.7 | yes | — |
| Highcastle Rd: Military Trl - Oakmeadow Blvd | ATR_VOLUME | 2007-09-25 | stale | 2524.7 | 08:15:00 (251) | -36861167#2 (pair) | 2.6 | yes | — |
| Galloway Rd: Kingston Rd - Montoro Lane | ATR_VOLUME | 2007-09-25 | stale | 5003 | 08:15:00 (473) | -445892457#3 (pair) | 1.4 | yes | — |
| Town Centre Crt: Borough Dr - McCowan Rd | ATR_VOLUME | 2007-09-25 | stale | 8060.7 | 07:45:00 (870) | 190539057#0 (pair) | 5.3 | yes | — |
| Tordale Cres: Applefield Dr - Waterfield Dr | ATR_SPEED_VOLUME | 2007-10-02 | stale | 92 | 06:30:00 (11) | -36783660#2 (pair) | 2.7 | yes | — |
| Tordale Cres: Waterfield Dr - Applefield Dr | ATR_SPEED_VOLUME | 2007-10-02 | stale | 105 | 07:15:00 (9) | -36783609#2 (pair) | 1.8 | yes | — |
| Waterfield Dr: Stokewell Pl - Tordale Cres | ATR_SPEED_VOLUME | 2007-10-02 | stale | 363 | 07:00:00 (24) | 36783630#0 (pair) | 1.1 | yes | — |
| Midwest Rd: Midland Ave - Great West Dr | ATR_SPEED_VOLUME | 2007-10-16 | stale | 4072 | 06:45:00 (322) | -24490356#44 (pair) | 0.8 | yes | — |
| Milner Business Crt: Milner Ave - Progress Ave | ATR_VOLUME | 2007-11-13 | stale | 1844.7 | 08:30:00 (186) | 23799306#0 (pair) | 2.1 | yes | — |
| Consilium Pl: Corporate Dr - Hwy 401 Collectors E / Mccowan Rd Ramp | ATR_VOLUME | 2007-11-13 | stale | 4603.3 | 08:45:00 (592) | 23799520#0 (pair) | 4.7 | yes | — |
| Corporate Dr: Progress Ave - Corporate Dr / Hwy 401 Collectors E Ramp | ATR_VOLUME | 2008-01-29 | stale | 4896.7 | 08:00:00 (481) | 235236364 (pair) | 5.3 | yes | — |
| Coronation Dr: Kitchener Rd - Limevale Cres | ATR_SPEED_VOLUME | 2008-04-08 | stale | 2651 | 07:45:00 (342) | -5756811#2 (pair) | 2.7 | yes | — |
| Brimley Rd: Graylee Ave - Citadel Dr | ATR_SPEED_VOLUME | 2008-04-09 | stale | 9870 | 09:15:00 (566) | 37229937#6 (pair) | 4.5 | yes | — |
| Bellamy Rd N: Pandora Crcl - Benleigh Dr | ATR_VOLUME | 2008-04-29 | stale | 8441.7 | 08:15:00 (718) | -36784371#2 (pair) | 13.1 | yes | — |
| Bellamy Rd N: Eastpark Blvd - Crusader St | ATR_SPEED_VOLUME | 2008-12-02 | stale | 7104 | 07:15:00 (664) | -27944957#5 (pair) | 2.4 | yes | — |
| Bellamy Rd N: Burnview Cres - Eastpark Blvd | ATR_SPEED_VOLUME | 2008-12-02 | stale | 6573 | 08:45:00 (551) | -27944957#3 (pair) | 4.3 | yes | — |
| Prince Philip Blvd to Sonneck Sq | ATR_SPEED_VOLUME | 2009-03-05 | stale | 781 | 08:00:00 (98) | 35303759#0 (pair) | 2.8 | yes | — |
| Hill Cres: Heathfield Dr - Muir Dr | ATR_SPEED_VOLUME | 2009-03-05 | stale | 1078 | 08:00:00 (121) | -500279618#0 (pair) | 1.9 | yes | — |
| Progress Ave: Production Dr - Estate Dr | ATR_SPEED_VOLUME | 2009-03-12 | stale | 17342 | 07:45:00 (1638) | -252976982#12 (pair) | 8.1 | yes | — |
| Channel Nine Crt to McCowan Rd | ATR_VOLUME | 2009-04-14 | stale | 2255 | 08:45:00 (98) | 31876704#0 (pair) | 1.0 | yes | — |
| Milner Ave: Markham Rd - Milner Business Crt | ATR_VOLUME | 2009-04-14 | stale | 8380.7 | 07:45:00 (1287) | 33542820#0 (pair) | 6.5 | yes | — |
| Milner Ave: Scunthorpe Rd - Markham Rd | ATR_VOLUME | 2009-04-14 | stale | 6983 | 09:15:00 (440) | 23799280#0 (pair) | 2.8 | yes | — |
| Milner Ave: Progress Ave - 380 Milner Ave | ATR_VOLUME | 2009-04-14 | stale | 8710.7 | 07:45:00 (1844) | 37236799#0 (pair) | 5.1 | yes | — |
| Milner Ave: Parkborough Blvd - Progress Ave | ATR_VOLUME | 2009-04-14 | stale | 6324.3 | 08:30:00 (587) | 371250125#0 (pair) | 6.7 | yes | — |
| Bellamy Rd N: Northleigh Dr - Bridlington St | ATR_SPEED_VOLUME | 2009-05-21 | stale | 14804 | 08:00:00 (1123) | -1288872291#3 (pair) | 2.1 | yes | — |
| Northleigh Dr: Erinlea Cres - Berkham Rd | ATR_SPEED_VOLUME | 2009-05-21 | stale | 654 | 08:00:00 (59) | 36784293 (pair) | 1.5 | yes | — |
| Beath St: Amiens Rd - Fairwood Cres | ATR_SPEED_VOLUME | 2009-05-27 | stale | 1394 | 07:45:00 (285) | -36859238 (pair) | 1.7 | yes | — |
| Fairwood Cres: Old Kingston Rd - Beath St | ATR_SPEED_VOLUME | 2009-05-27 | stale | 1383 | 07:45:00 (275) | 36859220#0 (pair) | 2.6 | yes | — |
| Fairwood Cres: Beath St - Amiens Rd | ATR_SPEED_VOLUME | 2009-05-27 | stale | 112 | 09:15:00 (14) | -36859218 (pair) | 2.6 | yes | — |
| Golden Gate Crt to Brimley Rd | ATR_VOLUME | 2009-09-15 | stale | 1869 | 09:00:00 (143) | -24490296#15 (pair) | 2.8 | yes | — |
| Grangeway Ave: Bushby Dr - Progress Ave | ATR_VOLUME | 2009-09-15 | stale | 9256 | 08:45:00 (525) | -26296427#1 (pair) | 1.0 | yes | — |
| Torrance Rd: 321 Trudelle St - Trudelle St | ATR_VOLUME | 2009-09-15 | stale | 892.7 | 08:00:00 (76) | -22486528#19 (pair) | 2.0 | yes | — |
| Torrance Rd: Trudelle St - Grace St | ATR_VOLUME | 2009-09-15 | stale | 961.7 | 07:45:00 (139) | -22486528#11 (pair) | 2.5 | yes | — |
| Consilium Pl: Progress Ave - Corporate Dr | ATR_VOLUME | 2009-09-15 | stale | 8512.7 | 06:30:00 (704) | -50887390#4 (pair) | 2.5 | yes | — |
| Waldock St: Galloway Rd - Havenway Gt | ATR_SPEED_VOLUME | 2009-10-22 | stale | 1495 | 08:00:00 (189) | -36859049#3 (pair) | 1.7 | yes | — |
| Waldock St: Eastview Park Trl - Poplar Rd | ATR_SPEED_VOLUME | 2009-10-22 | stale | 1186 | 08:00:00 (180) | -36859049#8 (pair) | 2.9 | yes | — |
| Hiscock Blvd: Densgrove Rd - Scranton Rd | ATR_SPEED_VOLUME | 2009-10-22 | stale | 1909 | 07:45:00 (138) | -36795763#14 (pair) | 1.5 | yes | — |
| Rodda Blvd: Lawrence Ave E - 10 Rodda Blvd | ATR_SPEED_VOLUME | 2009-11-10 | stale | 1553 | 07:45:00 (188) | 14603446#0 (pair) | 1.1 | yes | — |
| Coronation Dr: Wagner Dr - Morningside Ave | ATR_SPEED_VOLUME | 2009-11-10 | stale | 2918 | 07:45:00 (308) | 37356415#0 (pair) | 2.8 | yes | — |
| Poplar Rd: Danzig St - 4315 Kingston Rd | ATR_SPEED_VOLUME | 2009-11-10 | stale | 2110 | 08:00:00 (258) | -1352091080#0 (pair) | 2.6 | yes | — |
| Galloway Rd: Coronation Dr - 141 Galloway Rd | ATR_SPEED_VOLUME | 2009-11-10 | stale | 4907 | 08:00:00 (555) | -1490021005#2 (pair) | 2.1 | yes | — |
| Weir Cres: Craggview Dr - West Hill Park Trl | ATR_SPEED_VOLUME | 2009-11-10 | stale | 1184 | 07:45:00 (161) | -184514833#1 (pair) | 1.5 | yes | — |
| Warnsworth St: Rodda Blvd - Morningside Ave | ATR_SPEED_VOLUME | 2009-11-10 | stale | 3035 | 07:30:00 (338) | -36859240#2 (pair) | 2.5 | yes | — |
| Mooregate Ave: Stratton Ave - Shenley Rd | ATR_SPEED_VOLUME | 2009-12-08 | stale | 150 | 08:45:00 (8) | -1503074455 (pair) | 0.5 | yes | — |
| Mooregate Ave: Mooregate Park Trl - Treverton Dr | ATR_SPEED_VOLUME | 2009-12-08 | stale | 90 | 07:45:00 (10) | 35835548#0 (pair) | 6.3 | yes | — |
| Lawrence Ave E: 4255 Lawrence Ave E - Homestead Rd | ATR_SPEED_VOLUME | 2010-02-17 | stale | 7413 | 08:00:00 (412) | 1191384224#3 (pair) | 3.9 | yes | — |
| Lawrence Ave E: Homestead Rd - West Hill Dr | ATR_SPEED_VOLUME | 2010-02-17 | stale | 8349 | 07:15:00 (916) | 1191384224#2 (pair) | 4.2 | yes | — |
| Bellamy Rd S: Colonial Ave - Glen Muir Dr | ATR_SPEED_VOLUME | 2010-03-11 | stale | 1131 | 08:00:00 (157) | 35798550 (pair) | 1.4 | yes | — |
| Service Rd: Duncombe Blvd - Brinloor Blvd | ATR_SPEED_VOLUME | 2010-03-11 | stale | 773 | 07:45:00 (81) | -35798638 (pair) | 1.8 | yes | — |
| Waterfield Dr: Tordale Cres - Brimley Rd | ATR_VOLUME | 2010-04-06 | stale | 794.3 | 08:30:00 (78) | 36783521#0 (pair) | 1.3 | yes | — |
| Brimorton Dr: Durrington Cres - McCowan Rd | ATR_VOLUME | 2010-04-06 | stale | 2352 | 08:15:00 (178) | 36783533#0 (pair) | 3.7 | yes | — |
| Brimorton Dr: McCowan Rd - Lynnbrook Dr | ATR_VOLUME | 2010-04-06 | stale | 2733.7 | 08:00:00 (467) | 36784244#0 (pair) | 0.6 | yes | — |
| Brimorton Dr: Bellamy Rd N - Albacore Cres | ATR_VOLUME | 2010-04-06 | stale | 2809.3 | 07:45:00 (424) | -285904452 (pair) | 0.3 | yes | — |
| Brimorton Dr: Dolly Varden Blvd - Markham Rd | ATR_VOLUME | 2010-04-06 | stale | 3470.7 | 08:15:00 (230) | -461108535#2 (pair) | 0.3 | yes | — |
| Brimorton Dr: Markham Rd - Peace Dr | ATR_VOLUME | 2010-04-06 | stale | 3616.7 | 07:45:00 (476) | -36795812#1 (pair) | 1.6 | yes | — |
| Brimorton Dr: Hiscock Blvd - Scarborough Golf Club Rd | ATR_VOLUME | 2010-04-06 | stale | 2389 | 08:30:00 (141) | 36795858#0 (pair) | 1.2 | yes | — |
| Brimorton Dr: Scarborough Golf Club Rd - Welwyn Ave | ATR_VOLUME | 2010-04-06 | stale | 3566.3 | 08:00:00 (462) | -36795781 (pair) | 3.8 | yes | — |
| Brimorton Dr: Brimley Rd - Sancrest Dr | ATR_VOLUME | 2010-04-06 | stale | 3277.7 | 08:15:00 (235) | 36783513#0 (pair) | 1.4 | yes | — |
| Brimorton Dr: Curran Hall Cres - Orton Park Rd | ATR_VOLUME | 2010-04-06 | stale | 3151.3 | 08:15:00 (304) | 36795968#1 (pair) | 0.9 | yes | — |
| Scarborough Golf Club Rd: Brimorton Dr - Greenock Ave | ATR_VOLUME | 2010-04-20 | stale | 5390.3 | 08:00:00 (456) | -36796109#0 (pair) | 4.2 | yes | — |
| Scarborough Golf Club Rd: Mossbank Dr - Brimorton Dr | ATR_VOLUME | 2010-04-20 | stale | 7078 | 08:15:00 (544) | -36795776#1 (pair) | 4.7 | yes | — |
| Scarborough Golf Club Rd: Holmfirth Ter - Lawrence Ave E | ATR_VOLUME | 2010-04-20 | stale | 6221 | 08:15:00 (538) | -36795868#3 (pair) | 2.5 | yes | — |
| Neilson Rd: Ellesmere Rd - Trailridge Cres | ATR_VOLUME | 2010-05-04 | stale | 6076.3 | 08:15:00 (425) | -1264808027#1 (pair) | 4.1 | yes | — |
| Neilson Rd: Trailridge Cres - Purpledusk Trl | ATR_VOLUME | 2010-05-04 | stale | 9082 | 08:30:00 (573) | -1264808027#3 (pair) | 3.1 | yes | — |
| Neilson Rd: Purpledusk Trl - Gatineau Hydro Corridor Trl | ATR_VOLUME | 2010-05-04 | stale | 5292.7 | 08:15:00 (331) | -632963004 (pair) | 4.2 | yes | — |
| Neilson Rd: 2877 Ellesmere Rd - Ellesmere Rd | ATR_VOLUME | 2010-05-04 | stale | 5495.3 | 09:15:00 (307) | -42140834#1 (pair) | 2.0 | yes | — |
| Military Trl: Ellesmere Rd - 1275 Military Trl | ATR_VOLUME | 2010-05-04 | stale | 7841 | 08:30:00 (803) | 445437311#1 (pair) | 1.9 | yes | — |
| Military Trl to Neilson Rd | ATR_VOLUME | 2010-05-04 | stale | 1674.3 | 08:30:00 (129) | 498864116 (pair) | 2.0 | yes | — |
| Military Trl: Neilson Rd - 431 Military Trl | ATR_VOLUME | 2010-05-04 | stale | 2812.3 | 08:00:00 (440) | -632963007#17 (pair) | 2.6 | yes | — |
| Orton Park Rd: Lawrence Ave E - Northfield Rd | ATR_VOLUME | 2010-05-04 | stale | 8390.7 | 08:15:00 (741) | -36795848#2 (pair) | 2.3 | yes | — |
| Bonspiel Dr: Military Trl - Schmirler Ter | ATR_SPEED_VOLUME | 2010-06-01 | stale | 158 | 06:30:00 (14) | -632963007#31 (pair) | 35.7 | yes | — |
| Cumber Ave: Morna Ave - Morningside Ave | ATR_SPEED_VOLUME | 2010-06-02 | stale | 367 | 08:00:00 (36) | 36858938#0 (pair) | 2.3 | yes | — |
| Morna Ave: Cumber Ave - Tivoli Crt | ATR_SPEED_VOLUME | 2010-06-02 | stale | 141 | 07:45:00 (15) | -36858943#2 (pair) | 2.2 | yes | — |
| Morna Ave: Guildwood Pkwy - Cumber Ave | ATR_SPEED_VOLUME | 2010-06-02 | stale | 270 | 07:30:00 (23) | -36858945#2 (pair) | 2.6 | yes | — |
| Greencedar Crct: Crusader St - Daphne Rd | ATR_SPEED_VOLUME | 2010-08-10 | stale | 4650 | 09:15:00 (242) | 33635431#1 (pair) | 1.7 | yes | — |
| Bellamy Rd N: Farmbrook Rd - Cedar Brae Blvd | ATR_SPEED_VOLUME | 2010-09-16 | stale | 10762 | 08:00:00 (923) | 33724739#0 (pair) | 3.8 | yes | — |
| Conlins Rd: Military Trl - Ellesmere Rd | ATR_SPEED_VOLUME | 2010-09-16 | stale | 1161 | 07:45:00 (110) | -36854753#2 (pair) | 2.3 | yes | — |
| Lee Centre Dr: Lee Centre Park Trl - Corporate Dr | ATR_SPEED_VOLUME | 2010-09-16 | stale | 2679 | 08:00:00 (197) | 354413105#0 (pair) | 1.3 | yes | — |
| Lee Centre Dr to Lee Centre Park Trl (id: 30135146) | ATR_SPEED_VOLUME | 2010-09-16 | stale | 3048 | 08:00:00 (211) | -354413105#7 (pair) | 2.6 | yes | — |
| Lee Centre Dr: Corporate Dr - Lee Centre Park Trl | ATR_SPEED_VOLUME | 2010-09-16 | stale | 4925 | 08:00:00 (332) | 660806586#0 (pair) | 2.5 | yes | — |
| Fitzgibbon Ave: Wainfleet Rd - Lord Roberts Dr | ATR_SPEED_VOLUME | 2010-11-16 | stale | 428 | 08:15:00 (43) | -35835542 (pair) | 2.6 | yes | — |
| St Andrews Rd: Neapolitan Dr - Thomson Memorial Park Trl | ATR_SPEED_VOLUME | 2010-12-16 | stale | 2685 | 08:00:00 (301) | -36783520#1 (pair) | 2.1 | yes | — |
| Brookridge Dr: Lesterwood Cres - Rosswood Cres | ATR_SPEED_VOLUME | 2011-02-14 | stale | 511 | 08:00:00 (56) | 36783656#0 (pair) | 2.5 | yes | — |
| Brimorton Dr: Albacore Cres - Amberjack Blvd | ATR_SPEED_VOLUME | 2011-02-15 | stale | 3251 | 07:30:00 (326) | -36784346 (pair) | 0.1 | yes | — |
| Orton Park Rd: 400 Orton Park Rd - Heather Heights Woods Trl | ATR_VOLUME | 2011-05-04 | stale | 4058.7 | 08:15:00 (401) | 36796089#0 (pair) | 2.8 | yes | — |
| Tivoli Crt: Lalton Pl - Morna Ave | ATR_SPEED_VOLUME | 2011-06-14 | stale | 120.3 | 08:00:00 (12) | -36858952 (pair) | 2.7 | yes | — |
| Banmoor Blvd: Strandhill Rd - Walkway N of Blakemanor and W of Markham | ATR_SPEED_VOLUME | 2011-06-14 | stale | 182.3 | 07:15:00 (13) | -1494489813#0 (pair) | 2.1 | yes | — |
| Nightingale Pl to Par Ave | ATR_SPEED_VOLUME | 2011-06-14 | stale | 110.7 | 09:15:00 (9) | -36796039 (pair) | 2.3 | yes | — |
| Shediac Rd: Haileybury Dr - Penzance Dr | ATR_SPEED_VOLUME | 2011-06-15 | stale | 435 | 07:30:00 (61) | 7955626#0 (pair) | 2.2 | yes | — |
| Kingston Rd: West Hill Dr - Orchard Park Dr | ATR_SPEED_VOLUME | 2011-06-21 | stale | 36143 | 07:30:00 (3056) | 137892872 (pair) | 9.3 | yes | — |
| Birkdale Rd to Cartier Cres | ATR_SPEED_VOLUME | 2011-09-13 | stale | 534 | 08:15:00 (53) | -36783643#1 (pair) | 2.8 | yes | — |
| Barrymore Rd: Huntchester Cres - Kilbride Rd | ATR_SPEED_VOLUME | 2011-09-13 | stale | 1107 | 07:45:00 (86) | 36792197#2 (pair) | 2.8 | yes | — |
| Netheravon Rd to Portico Dr | ATR_SPEED_VOLUME | 2011-10-13 | stale | 440 | 08:00:00 (46) | -89185301#1 (pair) | 1.6 | yes | — |
| Bushby Dr: McCowan Rd - Grangeway Ave | ATR_VOLUME | 2011-11-01 | stale | 1424.7 | 07:15:00 (67) | 26296426#0 (pair) | 4.8 | yes | — |
| Lawrence Ave E: 3785 Lawrence Ave E - Mossbank Dr | ATR_VOLUME | 2011-11-08 | stale | 13499 | 08:15:00 (596) | 43172651#7 (pair) | 6.0 | yes | — |
| Lawrence Ave E: Marcos Blvd - Rushley Dr | ATR_VOLUME | 2011-11-08 | stale | 20508.3 | 07:30:00 (2295) | 437221764#11 (pair) | 3.7 | yes | — |
| Lawrence Ave E: Midland Ave - Brockley Dr | ATR_VOLUME | 2011-11-08 | stale | 39174.3 | 08:00:00 (2941) | -890834839#2 (pair) | 6.5 | yes | — |
| Lawrence Ave E to Midland Ave | ATR_VOLUME | 2011-11-08 | stale | 21227.7 | 08:30:00 (1102) | 340174247#0 (pair) | 7.6 | yes | — |
| Lawrence Ave E: Orchard Park Dr - Manse Rd | ATR_VOLUME | 2011-11-08 | stale | 9166.7 | 08:15:00 (475) | 1191384224#0 (pair) | 3.5 | yes | — |
| Lawrence Ave E: Morningside Ave - Ling Rd | ATR_VOLUME | 2011-11-08 | stale | 22155.7 | 07:45:00 (1625) | 1394174430#0 (pair) | 2.5 | yes | — |
| Lawrence Ave E: Ling Rd - 4255 Lawrence Ave E | ATR_VOLUME | 2011-11-08 | stale | 11249 | 07:30:00 (1396) | 1191384224#3 (pair) | 3.8 | yes | — |
| Lawrence Ave E: Rodda Blvd - Kingston Rd | ATR_VOLUME | 2011-11-08 | stale | 11360 | 08:30:00 (530) | 1378338180 (pair) | 5.6 | yes | — |
| Lawrence Ave E: Overture Rd - Galloway Rd | ATR_VOLUME | 2011-11-08 | stale | 26005.3 | 07:45:00 (2120) | 36804007#0 (pair) | 6.0 | yes | — |
| Lawrence Ave E: Galloway Rd - Andover Cres | ATR_VOLUME | 2011-11-08 | stale | 12405 | 07:15:00 (1318) | 36804726#11 (pair) | 5.6 | yes | — |
| Lawrence Ave E: Highland Creek Trl - Overture Rd | ATR_VOLUME | 2011-11-08 | stale | 12881.3 | 08:15:00 (633) | -5379201#0 (pair) | 4.7 | yes | — |
| Lawrence Ave E: Susan St - Orton Park Rd | ATR_VOLUME | 2011-11-08 | stale | 13449.3 | 08:15:00 (656) | 36803735#0 (pair) | 6.9 | yes | — |
| Lawrence Ave E: Orton Park Rd - 3950 Lawrence Ave E | ATR_VOLUME | 2011-11-08 | stale | 14398 | 07:30:00 (1721) | 36803736#0 (pair) | 6.3 | yes | — |
| Lawrence Ave E: Mossbank Dr - Susan St | ATR_VOLUME | 2011-11-08 | stale | 14472.3 | 07:30:00 (1738) | -43172651#6 (pair) | 6.7 | yes | — |
| Lawrence Ave E: Fortune Gt - Scarborough Golf Club Rd | ATR_VOLUME | 2011-11-08 | stale | 31281.3 | 07:45:00 (2528) | 36798253#0 (pair) | 6.4 | yes | — |
| Lawrence Ave E: Scarborough Golf Club Rd - 3785 Lawrence Ave E | ATR_VOLUME | 2011-11-08 | stale | 15000 | 07:45:00 (1890) | 36798557#0 (pair) | 7.4 | yes | — |
| Lawrence Ave E: 3601 Lawrence Ave E - Greenholm Crct | ATR_VOLUME | 2011-11-08 | stale | 15544.3 | 09:15:00 (652) | 36798620#4 (pair) | 6.0 | yes | — |
| Lawrence Ave E: Ben Stanton Blvd - Bellamy Rd N | ATR_VOLUME | 2011-11-08 | stale | 16777.7 | 08:30:00 (754) | 43307631#0 (pair) | 5.8 | yes | — |
| Lawrence Ave E: Hague Park Trl - Burnview Cres | ATR_VOLUME | 2011-11-08 | stale | 17324.3 | 08:30:00 (749) | 43307631#6 (pair) | 6.7 | yes | — |
| Lawrence Ave E: Valparaiso Ave - McCowan Rd | ATR_VOLUME | 2011-11-08 | stale | 17306.3 | 08:45:00 (852) | 439600157#0 (pair) | 4.1 | yes | — |
| Lawrence Ave E: McCowan Rd - Bendale Park Trl | ATR_VOLUME | 2011-11-08 | stale | 18274 | 07:30:00 (1923) | -439600156#2 (pair) | 6.0 | yes | — |
| Lawrence Ave E: Brimley Rd - Barrymore Rd | ATR_VOLUME | 2011-11-08 | stale | 36836.7 | 08:00:00 (2537) | 437221764#0 (pair) | 5.0 | yes | — |
| Lawrence Ave E: Barrymore Rd - Bendale Acres | ATR_VOLUME | 2011-11-08 | stale | 19367.7 | 07:30:00 (1853) | -437221763#1 (pair) | 6.0 | yes | — |
| Lawrence Ave E: Brockley Dr - Danielle Moore Crcl | ATR_VOLUME | 2011-11-08 | stale | 19444.3 | 08:15:00 (991) | 33635429#2 (pair) | 5.5 | yes | — |
| Morningside Ave: Kingston Rd - Tefft Rd | ATR_VOLUME | 2011-12-06 | stale | 24675.3 | 08:30:00 (1609) | 36859318#0 (pair) | 3.0 | yes | — |
| Morningside Ave: Coronation Dr - Danzig St | ATR_VOLUME | 2011-12-06 | stale | 5088.3 | 08:00:00 (349) | -1414589359#3 (pair) | 4.5 | yes | — |
| Morningside Ave: Dubarry Ave - Coronation Dr | ATR_VOLUME | 2011-12-06 | stale | 3995.7 | 08:30:00 (297) | 1311517187#2 (pair) | 4.5 | yes | — |
| Morningside Ave: Guildwood Pkwy - Cumber Ave | ATR_VOLUME | 2011-12-06 | stale | 6205 | 08:15:00 (735) | -26020474#1 (pair) | 3.4 | yes | — |
| Guildwood Pkwy: Chancery Lane - Guildwood Park Trl | ATR_SPEED_VOLUME | 2011-12-07 | stale | 3225 | 08:00:00 (441) | 25431314#0 (pair) | 5.6 | yes | — |
| Corporate Dr: Consilium Pl - Lee Centre Dr | ATR_SPEED_VOLUME | 2011-12-07 | stale | 10964 | 08:00:00 (793) | 354413103 (pair) | 4.4 | yes | — |
| Mossbank Dr: Caddy Dr - Par Ave | ATR_SPEED_VOLUME | 2012-04-03 | stale | 520 | 06:30:00 (30) | 36796122#0 (pair) | 2.8 | yes | — |
| Westcroft Dr: Rodda Blvd - Craggview Dr | ATR_SPEED_VOLUME | 2012-04-03 | stale | 357 | 08:15:00 (42) | -36859237#2 (pair) | 1.6 | yes | — |
| Westcroft Dr: Craggview Dr - Weir Cres | ATR_SPEED_VOLUME | 2012-04-03 | stale | 141 | 07:15:00 (13) | -36859230#2 (pair) | 1.5 | yes | — |
| Mossbank Dr: Hogan Dr - Golfhaven Dr | ATR_SPEED_VOLUME | 2012-04-03 | stale | 574 | 07:45:00 (50) | -36795947#1 (pair) | 2.8 | yes | — |
| Coronation Dr: Homestead Rd - Darlingside Dr | ATR_SPEED_VOLUME | 2012-04-03 | stale | 4406 | 07:45:00 (416) | 8162944#1 (pair) | 1.6 | yes | — |
| Ellesmere Rd: Spall Crt - Calverley Trl | ATR_SPEED_VOLUME | 2012-04-17 | stale | 9239 | 07:45:00 (910) | 36855333#0 (pair) | 3.8 | yes | — |
| McCowan Rd: Trudelle St - Thicketwood Dr | ATR_SPEED_VOLUME | 2012-05-16 | stale | 1782 | 07:15:00 (202) | -22486527#9 (pair) | 2.7 | yes | — |
| Seminole Ave: Gage Ave - Mackinac Cres | ATR_SPEED_VOLUME | 2012-06-27 | stale | 1221 | 08:00:00 (67) | 35835643#7 (pair) | 2.1 | yes | — |
| Seminole Ave: Tansley Ave - Gage Ave | ATR_SPEED_VOLUME | 2012-06-27 | stale | 1197 | 07:45:00 (56) | 35835643#6 (pair) | 2.4 | yes | — |
| Oakmeadow Blvd: Highcastle Rd - Neilson Rd | ATR_SPEED_VOLUME | 2012-07-10 | stale | 2604 | 08:30:00 (135) | 36861153#10 (pair) | 2.9 | yes | — |
| Oakmeadow Blvd to Stonefield Cres | ATR_SPEED_VOLUME | 2012-07-11 | stale | 1148 | 07:15:00 (69) | -36861120#10 (pair) | 2.7 | yes | — |
| Oakmeadow Blvd to Logstone Cres | ATR_SPEED_VOLUME | 2012-07-11 | stale | 307 | 08:45:00 (27) | 36861120#0 (pair) | 2.7 | yes | — |
| Oakmeadow Blvd: Gillbank Cres - Pineslope Cres | ATR_SPEED_VOLUME | 2012-07-11 | stale | 852 | 09:15:00 (53) | 36861153#6 (pair) | 2.9 | yes | — |
| Mountland Dr to Stonehenge Cres | ATR_SPEED_VOLUME | 2012-10-10 | stale | 427 | 08:00:00 (51) | -36796095#1 (pair) | 2.6 | yes | — |
| Mountland Dr: Churchill Heights Park Trl - Brimorton Dr | ATR_SPEED_VOLUME | 2012-10-10 | stale | 578 | 08:00:00 (61) | -36795961#4 (pair) | 2.3 | yes | — |
| Midland Ave: Romulus Dr - Prudential Dr | ATR_VOLUME | 2012-11-06 | stale | 12376 | 08:15:00 (1032) | 1384307050#0 (pair) | 4.6 | yes | — |
| Midland Ave: Prudential Dr - Lawrence Ave E | ATR_VOLUME | 2012-11-06 | stale | 25878 | 08:00:00 (1901) | -796653126#2 (pair) | 3.1 | yes | — |
| Midland Ave: Lawrence Ave E - Treewood St | ATR_VOLUME | 2012-11-06 | stale | 15659.3 | 08:00:00 (1145) | 39206429#0 (pair) | 4.6 | yes | — |
| Midland Ave: Norbury Cres - Dorcot Ave | ATR_VOLUME | 2012-11-06 | stale | 27955.7 | 07:45:00 (2101) | -340173402#12 (pair) | 3.8 | yes | — |
| Midland Ave: Millbridge Gt - Midwest Rd | ATR_VOLUME | 2012-11-06 | stale | 13871.3 | 08:00:00 (1029) | -320464907#24 (pair) | 2.1 | yes | — |
| Midland Ave: Midwest Rd - Canadine Rd | ATR_VOLUME | 2012-11-06 | stale | 16979 | 08:00:00 (1284) | 36783683#0 (pair) | 34.6 | yes | — |
| Midland Ave: Lord Roberts Dr - Stansbury Cres | ATR_VOLUME | 2012-11-06 | stale | 11760.3 | 08:00:00 (890) | 232196664#6 (pair) | 3.4 | yes | — |
| Deerfield Rd: Gully Dr - Bonnechere Cres | ATR_SPEED_VOLUME | 2012-11-15 | stale | 755 | 08:00:00 (78) | -35835594 (pair) | 2.7 | yes | — |
| Portico Dr: Helicon Gt - Netheravon Rd | ATR_SPEED_VOLUME | 2012-11-15 | stale | 669 | 08:00:00 (59) | 36796105#2 (pair) | 2.0 | yes | — |
| Rochman Blvd: Abbeville Rd - Sharbot Ave | ATR_SPEED_VOLUME | 2013-02-05 | stale | 564 | 07:45:00 (46) | 36784353#12 (pair) | 2.3 | yes | — |
| Eglinton Ave E: Bellamy Rd N - McCowan District Park Trl | ATR_VOLUME | 2013-03-26 | stale | 14813 | 08:00:00 (1458) | 37229607#0 (pair) | 7.5 | yes | — |
| Eglinton Ave E: McCowan District Park Trl - Mason Rd | ATR_VOLUME | 2013-03-26 | stale | 14959 | 08:30:00 (696) | 37229607#0 (pair) | 4.8 | yes | — |
| Eglinton Ave E: Beachell St - Centre St | ATR_VOLUME | 2013-03-26 | stale | 14775.3 | 08:15:00 (1563) | -37229659#5 (pair) | 5.8 | yes | — |
| Eglinton Ave E: Mason Rd - Beachell St | ATR_VOLUME | 2013-03-26 | stale | 29441.3 | 08:30:00 (2205) | -1317849511#2 (pair) | 5.2 | yes | — |
| Eglinton Ave E to Cedar Dr | ATR_VOLUME | 2013-03-26 | stale | 9286.7 | 08:15:00 (1116) | 37229701#0 (pair) | 7.3 | yes | — |
| Eglinton Ave E to Kingston Rd | ATR_VOLUME | 2013-03-26 | stale | 19984.3 | 08:00:00 (1584) | 37229699#0 (pair) | 4.8 | yes | — |
| Eglinton Ave E: Torrance Rd - Bellamy Rd N | ATR_VOLUME | 2013-03-26 | stale | 31319.7 | 08:15:00 (1979) | 37229612#1 (pair) | 27.9 | yes | — |
| Bellamy Rd N: Lynnbrook Dr - Ellesmere Rd | ATR_VOLUME | 2013-04-09 | stale | 9930 | 08:15:00 (949) | -1288872294#1 (pair) | 2.2 | yes | — |
| Bellamy Rd N: Amberjack Blvd - Brimorton Dr | ATR_VOLUME | 2013-04-09 | stale | 9679.7 | 08:30:00 (884) | -1288872292#1 (pair) | 3.9 | yes | — |
| Bellamy Rd N: Benleigh Dr - Gatineau Hydro Corridor Trl | ATR_VOLUME | 2013-04-09 | stale | 8499.7 | 08:15:00 (578) | -43326402#11 (pair) | 4.6 | yes | — |
| Bellamy Rd N: Walkway S of Benleigh and W of Bellamy - Pandora Crcl | ATR_VOLUME | 2013-04-09 | stale | 9017 | 08:15:00 (748) | -43326402#3 (pair) | 2.9 | yes | — |
| Bellamy Rd N: Lawrence Ave E - Indian Mound Cres | ATR_VOLUME | 2013-04-09 | stale | 8415 | 08:15:00 (620) | -43307629#1 (pair) | 2.7 | yes | — |
| Bellamy Rd N: Nelson St - Cedargrove Park Trl | ATR_VOLUME | 2013-04-09 | stale | 6395.3 | 08:00:00 (554) | 43326406#4 (pair) | 4.7 | yes | — |
| Bellamy Rd N: Grace St - Nelson St | ATR_VOLUME | 2013-04-09 | stale | 5521.7 | 08:15:00 (393) | 43326406#0 (pair) | 4.6 | yes | — |
| Bellamy Rd N: Porchester Dr - Grace St | ATR_VOLUME | 2013-04-09 | stale | 10139.7 | 08:00:00 (864) | 24488181#0 (pair) | 2.8 | yes | — |
| Bellamy Rd N: Eglinton Ave E - Trudelle St | ATR_VOLUME | 2013-04-09 | stale | 10775.3 | 08:15:00 (782) | -37229617 (pair) | 1.7 | yes | — |
| McCowan Rd: Mccowan Rd N / Hwy 401 Collectors E Ramp - Mccowan Rd S / Hwy 401 Collectors W Ramp | ATR_VOLUME | 2013-04-16 | stale | 26366 | 08:00:00 (1931) | 23799516 (pair) | 7.3 | yes | — |
| McCowan Rd: McCowan Rd S / Progress Ave Ramp - Hwy 401 Collectors E / Mccowan Rd Ramp | ATR_VOLUME | 2013-04-16 | stale | 25749.3 | 07:30:00 (1380) | 4934476 (pair) | 4.8 | yes | — |
| McCowan Rd: Triton Rd - McCowan Rd S / Progress Ave Ramp | ATR_VOLUME | 2013-04-16 | stale | 21005 | 08:15:00 (1654) | 205718511#0 (pair) | 10.1 | yes | — |
| McCowan Rd: Town Centre Crt - Triton Rd | ATR_VOLUME | 2013-04-16 | stale | 21877.3 | 08:15:00 (1721) | 35800155#0 (pair) | 6.6 | yes | — |
| McCowan Rd: Ellesmere Rd - Town Centre Crt | ATR_VOLUME | 2013-04-16 | stale | 42853.7 | 08:30:00 (2578) | 50888397#0 (pair) | 4.1 | yes | — |
| McCowan Rd: Walkway S of Ellesmere and W of Mccowan - Ellesmere Rd | ATR_VOLUME | 2013-04-16 | stale | 16533.3 | 08:30:00 (1112) | -36790143#2 (pair) | 3.2 | yes | — |
| McCowan Rd: Brimorton Dr - Huronia Gt | ATR_VOLUME | 2013-04-16 | stale | 15469.3 | 08:15:00 (1033) | -36790143#0 (pair) | 3.3 | yes | — |
| McCowan Rd: Meldazy Dr - Brimorton Dr | ATR_VOLUME | 2013-04-16 | stale | 15662.3 | 08:15:00 (990) | -1380158162#3 (pair) | 3.7 | yes | — |
| McCowan Rd: Gatineau Hydro Corridor Trl - Bellechasse St | ATR_VOLUME | 2013-04-16 | stale | 15057.7 | 08:15:00 (1177) | -33725369#2 (pair) | 4.6 | yes | — |
| McCowan Rd: Benleigh Dr - St Andrews Rd | ATR_VOLUME | 2013-04-16 | stale | 15310 | 08:15:00 (935) | 1417004905 (pair) | 4.8 | yes | — |
| McCowan Rd: Eglinton Ave E - Trudelle St | ATR_VOLUME | 2013-04-16 | stale | 3184.3 | 08:15:00 (260) | -330602795#3 (pair) | 1.0 | yes | — |
| McCowan Rd: Landmark Blvd - Eglinton Ave E | ATR_VOLUME | 2013-04-16 | stale | 6043.7 | 08:15:00 (484) | 330602795#0 (pair) | 39.1 | yes | — |
| McCowan Rd: Mccowan Rd S / Hwy 401 Collectors W Ramp - Milner Ave | ATR_VOLUME | 2013-04-16 | stale | 32224.3 | 08:45:00 (2355) | 36921157#0 (pair) | 8.9 | yes | — |
| McCowan Rd: Milner Ave - Pitfield Rd | ATR_VOLUME | 2013-04-16 | stale | 58641.7 | 08:00:00 (3895) | -214372067 (pair) | 5.3 | yes | — |
| Catalina Dr: Bethune Blvd - Sir Raymond Dr | ATR_SPEED_VOLUME | 2013-04-17 | stale | 514 | 08:15:00 (44) | -35303701 (pair) | 2.1 | yes | — |
| Lawrence Ave E: Markham Rd - 3601 Lawrence Ave E | ATR_VOLUME | 2013-06-14 | stale | 16153.3 | 08:00:00 (1709) | 36797403#0 (pair) | 8.7 | yes | — |
| Kingston Rd: Falaise Rd - Morningside Ave | ATR_VOLUME | 2013-09-24 | stale | 20646.3 | 08:30:00 (940) | 44350803#0 (pair) | 7.8 | yes | — |
| Kingston Rd: Saunders Rd - Guildwood Pkwy | ATR_VOLUME | 2013-09-24 | stale | 23732 | 08:30:00 (1264) | 445878559#5 (pair) | 8.1 | yes | — |
| Kingston Rd: Westlake Rd - Celeste Dr | ATR_VOLUME | 2013-09-24 | stale | 19575.7 | 08:15:00 (971) | 42146498#4 (pair) | 7.4 | yes | — |
| Kingston Rd: Muir Dr - Eglinton Ave E | ATR_VOLUME | 2013-09-24 | stale | 16812.7 | 08:15:00 (900) | 44311408#0 (pair) | 8.4 | yes | — |
| Kingston Rd: Eglinton Ave E - Scarborough Golf Club Rd | ATR_VOLUME | 2013-09-24 | stale | 42346.7 | 08:00:00 (3696) | 42140001 (pair) | 7.5 | yes | — |
| Kingston Rd: Guildwood Pkwy - Dale Ave | ATR_VOLUME | 2013-09-24 | stale | 19705.7 | 07:30:00 (2461) | 42146498#0 (pair) | 7.6 | yes | — |
| Kingston Rd: Galloway Rd - 4315 Kingston Rd | ATR_VOLUME | 2013-09-24 | stale | 16534.7 | 08:00:00 (1756) | 298209614#0 (pair) | 10.1 | yes | — |
| Kingston Rd: Celeste Dr - Payzac Ave | ATR_VOLUME | 2013-09-24 | stale | 39860 | 07:45:00 (3512) | 1317807571#0 (pair) | 10.3 | yes | — |
| Kingston Rd: Payzac Ave - Galloway Rd | ATR_VOLUME | 2013-09-24 | stale | 40520 | 07:45:00 (3491) | 445892459#0 (pair) | 8.9 | yes | — |
| Kingston Rd: Lawrence Ave E - Falaise Rd | ATR_VOLUME | 2013-09-24 | stale | 23460.3 | 07:45:00 (2937) | 1278988514 (pair) | 7.9 | yes | — |
| Kingston Rd: Kitchener Rd - Lawrence Ave E | ATR_VOLUME | 2013-09-24 | stale | 20312 | 08:30:00 (994) | 43248794#0 (pair) | 12.7 | yes | — |
| Kingston Rd: Ignatius Lane - Poplar Rd | ATR_VOLUME | 2013-09-24 | stale | 20191.7 | 08:15:00 (918) | 1317837107#0 (pair) | 8.8 | yes | — |
| Kingston Rd: Poplar Rd - Kitchener Rd | ATR_VOLUME | 2013-09-24 | stale | 22247 | 07:45:00 (2617) | 43248794#0 (pair) | 6.1 | yes | — |
| Kingston Rd: Fairwood Cres - Old Kingston Rd | ATR_VOLUME | 2013-09-24 | stale | 19189.3 | 08:15:00 (864) | 334899875#4 (pair) | 8.0 | yes | — |
| Kingston Rd: Old Kingston Rd - West Hill Dr | ATR_VOLUME | 2013-09-24 | stale | 17433 | 07:00:00 (2152) | 334899875#1 (pair) | 8.4 | yes | — |
| Kingston Rd: Morningside Ave - Collinsgrove Rd | ATR_VOLUME | 2013-09-24 | stale | 22435.3 | 08:00:00 (2984) | 36859250#0 (pair) | 8.5 | yes | — |
| Old Kingston Rd: West Hill Dr - Manse Rd | ATR_VOLUME | 2013-10-01 | stale | 4329.3 | 08:30:00 (415) | 1483490064#0 (pair) | 2.5 | yes | — |
| Janray Dr: Chandler Dr - Barnes Cres | ATR_SPEED_VOLUME | 2013-10-09 | stale | 539 | 08:00:00 (100) | -36795778#1 (pair) | 2.2 | yes | — |
| Amberjack Blvd: Bellamy Rd N - Daventry Rd | ATR_SPEED_VOLUME | 2013-10-22 | stale | 873 | 07:15:00 (67) | 36784256#0 (pair) | 1.9 | yes | — |
| Northfield Rd to Gondola Cres | ATR_SPEED_VOLUME | 2013-10-22 | stale | 359 | 08:15:00 (25) | 36795867#0 (pair) | 2.8 | yes | — |
| Brimley Rd: Eglinton Ave E - No Frills Lane | ATR_VOLUME | 2013-11-12 | stale | 12960.7 | 08:15:00 (1110) | -37229937#0 (pair) | 3.9 | yes | — |
| Brimley Rd: Strode Dr - Chillery Ave | ATR_VOLUME | 2013-11-12 | stale | 10744.7 | 08:15:00 (825) | 37229937#1 (pair) | 4.4 | yes | — |
| Brimley Rd: Chillery Ave - Elgar Ave | ATR_VOLUME | 2013-11-12 | stale | 11206 | 08:15:00 (932) | -37229937#4 (pair) | 4.2 | yes | — |
| Brimley Rd: Seminole Ave - Deerfield Rd | ATR_VOLUME | 2013-11-12 | stale | 11040.7 | 08:15:00 (853) | -44705953#5 (pair) | 3.8 | yes | — |
| Brimley Rd: Largo Lane - Shediac Rd | ATR_VOLUME | 2013-11-12 | stale | 11280 | 08:15:00 (914) | -44705953#8 (pair) | 4.3 | yes | — |
| Brimley Rd: Shediac Rd - Canzone Dr | ATR_VOLUME | 2013-11-12 | stale | 11747.3 | 08:00:00 (916) | -44705953#10 (pair) | 3.1 | yes | — |
| Brimley Rd: Haileybury Dr - Corner Lane | ATR_VOLUME | 2013-11-12 | stale | 12975 | 08:15:00 (1104) | 44705953#18 (pair) | 4.8 | yes | — |
| Brimley Rd: Lawrence Ave E - Thomson Memorial Park Trl | ATR_VOLUME | 2013-11-12 | stale | 13081.3 | 08:15:00 (1072) | -320608752#1 (pair) | 2.7 | yes | — |
| Brimley Rd: St Andrews Rd - Brimorton Dr | ATR_VOLUME | 2013-11-12 | stale | 13871.3 | 07:45:00 (1143) | 36789580 (pair) | 4.2 | yes | — |
| Brimley Rd: Brimorton Dr - Bernadine St | ATR_VOLUME | 2013-11-12 | stale | 27384.3 | 08:15:00 (2085) | 36787307#5 (pair) | 4.4 | yes | — |
| Brimley Rd: Bernadine St - Ellesmere Rd | ATR_VOLUME | 2013-11-12 | stale | 29885 | 08:15:00 (2413) | 36787307#0 (pair) | 4.4 | yes | — |
| Brimley Rd: Ellesmere Rd - Omni Dr | ATR_VOLUME | 2013-11-12 | stale | 15040.7 | 08:15:00 (1058) | 135953624#0 (pair) | 4.0 | yes | — |
| Brimley Rd: Omni Dr - Triton Rd | ATR_VOLUME | 2013-11-12 | stale | 16700.7 | 08:15:00 (1242) | 1334846125#0 (pair) | 3.0 | yes | — |
| Brimley Rd: Triton Rd - Progress Ave | ATR_VOLUME | 2013-11-12 | stale | 35103.3 | 08:00:00 (2583) | 50887292#0 (pair) | 3.1 | yes | — |
| Brimley Rd: Progress Ave - Hwy 401 Collectors E / Brimley S Ramp | ATR_VOLUME | 2013-11-12 | stale | 22991.3 | 07:45:00 (1762) | 35346521 (pair) | 2.6 | yes | — |
| Brimley Rd: Walkway S of Sheppard and W of Brimley - Sheppard Ave E | ATR_VOLUME | 2013-11-12 | stale | 25288 | 08:15:00 (2092) | 61108948#0 (pair) | 2.3 | yes | — |
| Brimley Rd: Sheppard Ave E - East Highland Creek Trl | ATR_VOLUME | 2013-11-12 | stale | 13378.3 | 08:15:00 (1474) | 56051869#0 (pair) | 3.3 | yes | — |
| Brimley Rd: Groveleaf Rd - Pitfield Rd | ATR_VOLUME | 2013-11-14 | stale | 13774 | 08:15:00 (873) | -1394496446#1 (pair) | 3.5 | yes | — |
| Service Rd: Lane E of Markham and S of Service - Duncombe Blvd | ATR_SPEED_VOLUME | 2013-11-26 | stale | 1098 | 07:30:00 (94) | -1445346354 (pair) | 2.5 | yes | — |
| Keeler Blvd: Neilson Rd - Sandrift Sq | ATR_SPEED_VOLUME | 2013-12-03 | stale | 1687 | 08:00:00 (257) | 1264414833#0 (pair) | 29.7 | yes | — |
| Galloway Rd: Guildwood Pkwy - Dearham Wood | ATR_SPEED_VOLUME | 2014-03-27 | stale | 1009 | 08:00:00 (116) | -1302266958#1 (pair) | 1.6 | yes | — |
| Markham Rd: Hwy 401 Collectors W / Markham Rd Ramp - Markham Rd S / Hwy 401 Collectors W Ramp | ATR_VOLUME | 2014-04-15 | stale | 21025 | 08:15:00 (1365) | 265724837#0 (pair) | 5.5 | yes | — |
| Markham Rd: Luella St - Cougar Crt | ATR_VOLUME | 2014-04-15 | stale | 15349 | 08:00:00 (1072) | -306061603#4 (pair) | 12.5 | yes | — |
| Markham Rd: Dunelm St - Blakemanor Blvd | ATR_VOLUME | 2014-04-15 | stale | 14744 | 08:00:00 (894) | -43224348 (pair) | 4.0 | yes | — |
| 435 Markham Rd to Markham Rd | ATR_VOLUME | 2014-04-15 | stale | 16288.7 | 08:00:00 (1114) | -43224676 (pair) | 23.7 | yes | — |
| Markham Rd: 435 Markham Rd - Eastpark Blvd | ATR_VOLUME | 2014-04-15 | stale | 16001.7 | 08:00:00 (964) | -43224676 (pair) | 4.0 | yes | — |
| Markham Rd: Markham Rd N / Hwy 401 Collectors W Ramp - Hwy 401 Collectors W / Markham Rd Ramp | ATR_VOLUME | 2014-04-15 | stale | 33042.7 | 08:15:00 (2234) | 23799529 (pair) | 8.7 | yes | — |
| Markham Rd: Progress Ave - Markham Rd N / Hwy 401 Collectors E Ramp | ATR_VOLUME | 2014-04-15 | stale | 35538 | 08:00:00 (2727) | 416992197#0 (pair) | 4.7 | yes | — |
| Markham Rd: Morningside Park Trl - Progress Ave | ATR_VOLUME | 2014-04-15 | stale | 30430.3 | 07:45:00 (1952) | 549422013#0 (pair) | 2.3 | yes | — |
| Markham Rd: Tuxedo Crt - Morningside Park Trl | ATR_VOLUME | 2014-04-15 | stale | 31687.7 | 07:45:00 (2054) | -433239618#1 (pair) | 5.8 | yes | — |
| Markham Rd: Gatineau Hydro Corridor Trl - Brimorton Dr | ATR_VOLUME | 2014-04-15 | stale | 21719 | 08:00:00 (1193) | 1353953506#0 (pair) | 1.7 | yes | — |
| Markham Rd to Painted Post Dr | ATR_VOLUME | 2014-04-15 | stale | 22555.7 | 08:15:00 (1338) | 1288863205#0 (pair) | 4.8 | yes | — |
| Markham Rd: Scranton Rd - Painted Post Dr | ATR_VOLUME | 2014-04-15 | stale | 21736 | 08:00:00 (1198) | 1288863203#0 (pair) | 2.5 | yes | — |
| Sheppard Ave E: McCowan Rd - Shorting Rd | ATR_VOLUME | 2014-04-22 | stale | 16343.3 | 08:00:00 (1468) | -36921183#3 (pair) | 4.6 | yes | — |
| Sheppard Ave E: Brownspring Rd - McCowan Rd | ATR_VOLUME | 2014-04-22 | stale | 16339.7 | 08:30:00 (924) | -874152049#1 (pair) | 4.9 | yes | — |
| Danforth Rd: Wetherby Dr - Trudelle St | ATR_VOLUME | 2014-05-20 | stale | 11738.3 | 08:30:00 (774) | 474021760#0 (pair) | 21.8 | yes | — |
| Danforth Rd: Trudelle St - Pringdale Gardens Crcl | ATR_VOLUME | 2014-05-20 | stale | 13601 | 08:15:00 (1043) | -1380179680#2 (pair) | 3.9 | yes | — |
| Danforth Rd: Pringdale Gardens Crcl - Savarin St | ATR_VOLUME | 2014-05-20 | stale | 13276.7 | 08:15:00 (943) | -1381084885#2 (pair) | 4.4 | yes | — |
| Danforth Rd: Savarin St - 1375 Danforth Rd | ATR_VOLUME | 2014-05-20 | stale | 13971 | 08:15:00 (961) | -1381032291#5 (pair) | 2.0 | yes | — |
| Danforth Rd: Carslake Cres - Seminole Ave | ATR_VOLUME | 2014-05-20 | stale | 13319.3 | 08:00:00 (961) | 129726925#11 (pair) | 3.1 | yes | — |
| Danforth Rd: Seminole Ave - Elmdon Crt | ATR_VOLUME | 2014-05-20 | stale | 13157.7 | 07:45:00 (932) | 129726925#9 (pair) | 3.5 | yes | — |
| Danforth Rd: Mackinac Cres - Barrymore Rd | ATR_VOLUME | 2014-05-20 | stale | 12246.3 | 08:00:00 (928) | -129726925#7 (pair) | 4.1 | yes | — |
| Lord Roberts Dr: Tremely Cres - Fitzgibbon Ave | ATR_SPEED_VOLUME | 2014-05-21 | stale | 934 | 08:15:00 (175) | 35835516#0 (pair) | 1.5 | yes | — |
| Scarborough Golf Club Rd: Gatesview Ave - Dunelm St | ATR_SPEED_VOLUME | 2014-09-10 | stale | 7402 | 08:00:00 (772) | 43171759#0 (pair) | 2.4 | yes | — |
| Scarborough Golf Club Rd: Kingston Rd - Jeremiah Lane | ATR_SPEED_VOLUME | 2014-09-10 | stale | 7293 | 08:00:00 (784) | -43171751#5 (pair) | 0.8 | yes | — |
| Sheppard Ave E: Fulham St - Brimley Rd | ATR_VOLUME | 2014-09-13 | stale | 16183 | 08:45:00 (979) | 61108960#0 (pair) | 7.5 | yes | — |
| Sheppard Ave E: Brimley Rd - Brownspring Rd | ATR_VOLUME | 2014-09-13 | stale | 13851.6 | 08:00:00 (1471) | -61108949#19 (pair) | 5.5 | yes | — |
| Ellesmere Rd: Watson St - Walkway W of Morrish and N of Ellesmere | ATR_VOLUME | 2014-09-16 | stale | 4710.3 | 08:45:00 (249) | 36855333#0 (pair) | 4.1 | yes | — |
| Ellesmere Rd: Mirrow Crt - Conlins Rd | ATR_VOLUME | 2014-09-16 | stale | 6287 | 08:30:00 (297) | -36854991#1 (pair) | 4.8 | yes | — |
| Ellesmere Rd: Conlins Rd - Gladys Rd | ATR_VOLUME | 2014-09-16 | stale | 6167.3 | 08:00:00 (1006) | 226442552 (pair) | 4.7 | yes | — |
| Ellesmere Rd: Mornelle Crt - Morningside Ave | ATR_VOLUME | 2014-09-16 | stale | 9438.3 | 08:30:00 (466) | -1264417462#2 (pair) | 3.9 | yes | — |
| Ellesmere Rd: 2863 Ellesmere Rd - Neilson Rd | ATR_VOLUME | 2014-09-16 | stale | 10447.7 | 08:30:00 (685) | 36861608#0 (pair) | 4.4 | yes | — |
| Ellesmere Rd: Neilson Rd - Mornelle Crt | ATR_VOLUME | 2014-09-16 | stale | 10673 | 07:45:00 (1472) | -37403801#2 (pair) | 3.4 | yes | — |
| Ellesmere Rd: Orton Park Rd - Morningside Park Trl | ATR_VOLUME | 2014-09-16 | stale | 11676 | 08:00:00 (1291) | -36861616#2 (pair) | 3.5 | yes | — |
| Ellesmere Rd: Chancellor Dr - Gatineau Hydro Corridor Trl | ATR_VOLUME | 2014-09-16 | stale | 12582.7 | 09:15:00 (638) | 36796634#0 (pair) | 5.0 | yes | — |
| Ellesmere Rd: Scarborough Golf Club Rd - Orton Park Rd | ATR_VOLUME | 2014-09-16 | stale | 25307.3 | 08:00:00 (2101) | 43174075#0 (pair) | 3.4 | yes | — |
| Ellesmere Rd: Parkington Cres - Bellamy Rd N | ATR_VOLUME | 2014-09-16 | stale | 15144 | 08:45:00 (846) | 36784857#0 (pair) | 3.7 | yes | — |
| Ellesmere Rd: Bellamy Rd N - Confederation Park Trl | ATR_VOLUME | 2014-09-16 | stale | 27662 | 08:30:00 (2080) | 23809601#0 (pair) | 3.9 | yes | — |
| Ellesmere Rd: Saratoga Dr - McCowan Rd | ATR_VOLUME | 2014-09-16 | stale | 16357.7 | 08:45:00 (894) | 205717851#0 (pair) | 7.9 | yes | — |
| Ellesmere Rd: McCowan Rd - Stoneton Dr | ATR_VOLUME | 2014-09-16 | stale | 16530.7 | 08:00:00 (1613) | 433827566 (pair) | 5.7 | yes | — |
| Ellesmere Rd: Packard Blvd - Borough Approach E | ATR_VOLUME | 2014-09-16 | stale | 15554.7 | 08:30:00 (856) | 36787101#0 (pair) | 8.2 | yes | — |
| Ellesmere Rd: Borough Approach E - Saratoga Dr | ATR_VOLUME | 2014-09-16 | stale | 16247.3 | 08:00:00 (1664) | 36787100 (pair) | 7.3 | yes | — |
| Ellesmere Rd: Birkdale Ravine Trl - Brimley Rd | ATR_VOLUME | 2014-09-16 | stale | 16738 | 08:30:00 (907) | 36787663#0 (pair) | 6.9 | yes | — |
| Ellesmere Rd: Brimley Rd - Borough Approach W | ATR_VOLUME | 2014-09-16 | stale | 17983.3 | 08:15:00 (1808) | 36787103#0 (pair) | 17.9 | yes | — |
| Ellesmere Rd: Midland Ave - Oakley Blvd | ATR_VOLUME | 2014-09-16 | stale | 17289 | 08:00:00 (1817) | -448500603#13 (pair) | 3.3 | yes | — |
| Markham Rd: Markham Rd N / Hwy 401 Collectors E Ramp - Hwy 401 Collectors E / Markham Rd N Ramp | ATR_VOLUME | 2014-09-20 | stale | 20601.4 | 08:00:00 (1286) | 455881114#0 (pair) | 6.9 | yes | — |
| Markham Rd: Hwy 401 Collectors E / Markham Rd N Ramp - Markham Rd S / Hwy 401 Collectors E Ramp | ATR_VOLUME | 2014-09-20 | stale | 14522 | 08:45:00 (1005) | 286782348 (pair) | 6.9 | yes | — |
| Markham Rd: Markham Rd S / Hwy 401 Collectors W Ramp - Milner Ave | ATR_VOLUME | 2014-09-20 | stale | 30303.7 | 08:15:00 (2124) | -37236805#1 (pair) | 4.0 | yes | — |
| Markham Rd: Service Rd - Kingston Rd | ATR_VOLUME | 2014-09-20 | stale | 3209.3 | 07:45:00 (278) | 48715757#0 (pair) | 39.8 | yes | — |
| Markham Rd: Kingston Rd - Markanna Dr | ATR_VOLUME | 2014-09-20 | stale | 4936.7 | 08:45:00 (316) | 417876560 (pair) | 5.8 | yes | — |
| Markham Rd: Eglinton Ave E - Luella St | ATR_VOLUME | 2014-09-20 | stale | 8699.9 | 08:15:00 (578) | 306061601#0 (pair) | 5.3 | yes | — |
| Markham Rd: Lawrence Ave E - Greenholm Crct | ATR_VOLUME | 2014-09-20 | stale | 13091.3 | 08:45:00 (873) | 1288863197#0 (pair) | 1.8 | yes | — |
| Aveline Cres to Lynnbrook Dr | ATR_SPEED_VOLUME | 2014-11-19 | stale | 292 | 08:00:00 (75) | -36784239#5 (pair) | 0.2 | yes | — |
| Keeler Blvd to Sandrift Sq | ATR_SPEED_VOLUME | 2020-01-28 | recent | 2590.7 | 08:00:00 (230) | -36861136 (pair) | 90.7 | NO | — |
| Brussels Rd: Winter Ave - Falmouth Ave | VEHICLE_CLASS | 2020-09-29 | recent | 458 | 08:00:00 (43) | — (pair) | — | NO | — |
| Gilder Dr: Midland Ave - Eglinton Ave E | ATR_SPEED_VOLUME | 2021-07-20 | recent | 1714.7 | 08:45:00 (89) | 232196664#0 (pair) | 142.8 | NO | — |
| Duncombe Blvd: Brinloor Blvd - Shirley Cres | ATR_SPEED_VOLUME | 2021-11-30 | recent | 1413.7 | 08:15:00 (194) | -35798517 (pair) | 114.0 | NO | — |
| Manse Rd: Hainford St - Mansewood Gdns | VEHICLE_CLASS | 2021-11-30 | recent | 5412.3 | 07:45:00 (487) | — (pair) | — | NO | — |
| Maretta Ave: Khartoum Ave - Rutledge Ave | ATR_SPEED_VOLUME | 2022-03-22 | recent | 67 | 08:00:00 (7) | — (pair) | — | NO | — |
| Heather Rd: Lane W of Shilton and N of Heather Rd - Shilton Rd | ATR_SPEED_VOLUME | 2022-04-05 | recent | 1063 | 08:00:00 (223) | — (pair) | — | NO | — |
| Kingston Rd: Lochleven Dr - 3430 Kingston Rd | ATR_SPEED_VOLUME | 2022-05-31 | recent | 23902.3 | 07:45:00 (1527) | — (pair) | — | NO | — |
| Kingston Rd: Tollgate Mews - Whitecap Blvd | ATR_SPEED_VOLUME | 2022-05-31 | recent | 24249.7 | 08:15:00 (1427) | 35798550 (pair) | 142.8 | NO | — |
| Hill Cres: Duncombe Blvd - Heathfield Dr | ATR_SPEED_VOLUME | 2023-01-10 | recent | 1463 | 08:00:00 (169) | -500279618#0 (pair) | 131.1 | NO | — |
| Hill Cres: Brinloor Blvd - Duncombe Blvd | ATR_SPEED_VOLUME | 2023-01-10 | recent | 1447 | 08:00:00 (170) | — (pair) | — | NO | — |
| Markham Rd: Shirley Cres - Service Rd | ATR_SPEED_VOLUME | 2023-03-21 | recent | 1508 | 08:45:00 (124) | — (pair) | — | NO | — |
| Markham Rd: Hill Cres - Shirley Cres | ATR_SPEED_VOLUME | 2023-03-21 | recent | 1279.7 | 08:30:00 (107) | — (pair) | — | NO | — |
| Oakridge Dr: Rockwood Dr - Cree Ave | ATR_SPEED_VOLUME | 2023-03-21 | recent | 1013 | 08:15:00 (103) | — (pair) | — | NO | — |
| Eglinton Ave E to Hydro Corridor | ATR_SPEED_VOLUME | 2023-05-09 | recent | 24316 | 08:30:00 (1559) | — (pair) | — | NO | — |
| Kennedy Rd: Stratton Ave - Jack Goodlad Park Trl | ATR_SPEED_VOLUME | 2023-05-09 | recent | 22246 | 08:00:00 (1596) | -1503074455 (pair) | 131.6 | NO | — |
| Morrish Rd: Ellesmere Rd - Grantown Ave | ATR_SPEED_VOLUME | 2023-08-01 | recent | 2077 | 08:30:00 (127) | 36855333#0 (pair) | 144.1 | NO | — |
| Lawrence Ave E: Wildflower Way - Valia Rd | ATR_SPEED_VOLUME | 2023-08-01 | recent | 11874.7 | 08:30:00 (715) | — (pair) | — | NO | — |
| Kennedy Rd: Radnor Ave - Mike Myers Dr | ATR_SPEED_VOLUME | 2023-10-31 | recent | 26110.3 | 08:15:00 (1744) | — (pair) | — | NO | — |
| Boyce Ave: Brimley Rd - Oswego Rd | ATR_SPEED_VOLUME | 2023-11-07 | recent | 811.3 | 08:00:00 (75) | — (pair) | — | NO | — |
| Kingsdown Dr: Kennedy Rd - Yorkshire Rd | ATR_SPEED_VOLUME | 2023-11-07 | recent | 395.3 | 08:00:00 (36) | — (pair) | — | NO | — |
| Kingsdown Dr: Yorkshire Rd - Ranstone Gdns | ATR_SPEED_VOLUME | 2023-11-07 | recent | 635.7 | 08:00:00 (54) | — (pair) | — | NO | — |
| Watson St: Glenthorne Dr - Wishaw Rd | ATR_SPEED_VOLUME | 2023-12-05 | recent | 1591.3 | 08:15:00 (115) | — (pair) | — | NO | — |
| Watson St: Wishaw Rd - Walkway S of Ellesmere and W of Watson | ATR_SPEED_VOLUME | 2023-12-05 | recent | 1580.7 | 08:30:00 (119) | — (pair) | — | NO | — |
| Watson St: Old Kingston Rd - Thomas Ave | ATR_SPEED_VOLUME | 2023-12-05 | recent | 1697 | 08:30:00 (121) | -227818179#2 (pair) | 145.8 | NO | — |
| Ionview Rd: Flempton Cres - Yorkshire Rd | ATR_SPEED_VOLUME | 2024-02-27 | recent | 1023.3 | 08:00:00 (133) | — (pair) | — | NO | — |
| Ranstone Gdns: Givendale Rd - Kingsdown Dr | ATR_SPEED_VOLUME | 2024-10-01 | recent | 2456.7 | 08:15:00 (235) | — (pair) | — | NO | — |
| Wetherby Dr: Brimley Rd - Shaddock Cres | ATR_SPEED_VOLUME | 2024-12-17 | recent | 1574.7 | 07:45:00 (132) | 35798445#0 (pair) | 87.1 | NO | — |
| Broadbent Ave: Midland Ave - Chipper Cres | ATR_SPEED_VOLUME | 2025-01-07 | recent | 907.7 | 08:15:00 (127) | -35796837#1 (pair) | 61.9 | NO | — |
| Ellesmere Rd to Zezel Way | ATR_SPEED_VOLUME | 2025-08-12 | recent | 3052.7 | 08:00:00 (194) | — (pair) | — | NO | — |
| Ellesmere Rd: Zezel Way - Great West Dr | ATR_SPEED_VOLUME | 2025-08-12 | recent | 2859.7 | 09:15:00 (166) | — (pair) | — | NO | — |
| Bertrand Ave: Iondale Pl - Midholm Dr | ATR_SPEED_VOLUME | 2025-08-26 | recent | 2091 | 08:30:00 (109) | — (pair) | — | NO | — |
| Manse Rd: Grey Abbey Park Trl - Coronation Dr | ATR_SPEED_VOLUME | 2026-03-24 | recent | 667 | 06:45:00 (48) | -25372419#0 (pair) | 122.5 | NO | — |
| Manse Rd: Deanscroft Sq - 235 Manse Rd | ATR_SPEED_VOLUME | 2026-03-24 | recent | 4729.7 | 08:00:00 (437) | 8162944#0 (pair) | 127.9 | NO | — |
| Calverley Trl: Ellesmere Rd - Fishery Rd | ATR_SPEED_VOLUME | 2026-04-14 | recent | 966.3 | 08:00:00 (72) | 36855333#0 (pair) | 108.8 | NO | — |
| Homestead Rd: Darlingside Dr - Coronation Dr | ATR_SPEED_VOLUME | 2026-04-14 | recent | 282.7 | 08:15:00 (21) | -25372422#1 (pair) | 111.2 | NO | — |
| Homestead Rd: Coronation Dr - Skelding Crt | ATR_SPEED_VOLUME | 2026-04-14 | recent | 1787 | 07:45:00 (178) | 39871989#0 (pair) | 109.9 | NO | — |
| Rosemount Dr: Maida Vale - Richome Crt | ATR_SPEED_VOLUME | 2026-04-14 | recent | 1567 | 08:15:00 (132) | — (pair) | — | NO | — |
| Ionview Rd to Flempton Cres | ATR_SPEED_VOLUME | 2026-06-23 | recent | 1028.7 | 08:15:00 (128) | — (pair) | — | NO | — |
| Ionview Rd: Corinne Cres - Landseer Rd | ATR_SPEED_VOLUME | 2026-06-23 | recent | 1675 | 08:15:00 (112) | — (pair) | — | NO | — |
| Falmouth Ave: Brussels Rd - Century Dr | ATR_SPEED_VOLUME | 2015-03-11 | aging | 1419 | 08:00:00 (106) | — (pair) | — | NO | — |
| Mason Rd: Greendowns Dr - Stanland Dr | ATR_SPEED_VOLUME | 2015-04-15 | aging | 1869 | 09:00:00 (95) | 43328162#0 (pair) | 79.0 | NO | — |
| Great West Dr: Lane 2 S of Ellesmere and W of Great West - Kawneer Ter | ATR_SPEED_VOLUME | 2015-06-30 | aging | 812 | 08:15:00 (76) | — (pair) | — | NO | — |
| Kawneer Ter: Zezel Way - Great West Dr | ATR_SPEED_VOLUME | 2015-06-30 | aging | 145 | 08:30:00 (17) | — (pair) | — | NO | — |
| De Jong St: Zezel Way - Great West Dr | ATR_SPEED_VOLUME | 2015-06-30 | aging | 167 | 08:15:00 (20) | — (pair) | — | NO | — |
| Zezel Way: Kawneer Ter - Lane 2 S of Ellesmere and W of Great West | ATR_SPEED_VOLUME | 2015-06-30 | aging | 236 | 08:00:00 (29) | — (pair) | — | NO | — |
| McCowan Rd: Sheppard Ave E - Nugget Ave | ATR_VOLUME | 2016-01-30 | aging | 21443.9 | 08:15:00 (1775) | 36921179#0 (pair) | 74.3 | NO | — |
| Eglinton Ave E to Midland Ave | ATR_SPEED_VOLUME | 2017-01-26 | aging | 39905 | 07:45:00 (2767) | — (pair) | — | NO | — |
| Danforth Rd: Eglinton Ave E - No Frills Lane | ATR_VOLUME | 2017-05-09 | aging | 11260.3 | 08:15:00 (931) | — (pair) | — | NO | — |
| Danforth Rd: Horton Blvd - Eglinton Ave E | ATR_VOLUME | 2017-05-09 | aging | 8996.3 | 08:15:00 (627) | — (pair) | — | NO | — |
| Midland Ave: Progress Ave - Hwy 401 Collectors W / Hwy 401 Express W | ATR_SPEED_VOLUME | 2017-10-18 | aging | 20747 | 07:45:00 (1546) | — (pair) | — | NO | — |
| Neilson Rd to Oakmeadow Blvd | ATR_SPEED_VOLUME | 2017-11-08 | aging | 15577 | 08:00:00 (1227) | -36861150#2 (pair) | 66.0 | NO | — |
| Keeler Blvd: Sandrift Sq - Edenmills Dr | ATR_SPEED_VOLUME | 2018-03-27 | aging | 2407 | 08:00:00 (220) | -36861136 (pair) | 90.0 | NO | — |
| Bertrand Ave: Lozoway Dr - Ionview Rd | ATR_SPEED_VOLUME | 2019-04-16 | aging | 5470.5 | 07:45:00 (458) | — (pair) | — | NO | — |
| Lozoway Dr: Bertrand Ave - Hardcastle St | ATR_SPEED_VOLUME | 2019-04-16 | aging | 165.5 | 08:00:00 (31) | — (pair) | — | NO | — |
| Bimbrok Rd: Eglinton Ave E - Gadsby Dr | ATR_SPEED_VOLUME | 2019-06-25 | aging | 1524.7 | 07:45:00 (119) | -35835538 (pair) | 108.9 | NO | — |
| Eglinton Ave E: Commonwealth Ave - Huntington Ave | ATR_SPEED_VOLUME | 2019-09-18 | aging | 19404 | 08:00:00 (1176) | — (pair) | — | NO | — |
| Eglinton Ave E: McCowan Rd - Torrance Rd | ATR_VOLUME | 2019-09-19 | aging | 15823.9 | 07:30:00 (1718) | 22486528#12 (pair) | 127.6 | NO | — |
| Eglinton Ave E: Barbados Blvd - McCowan Rd | ATR_VOLUME | 2019-09-19 | aging | 17696.6 | 08:30:00 (954) | 330602795#0 (pair) | 129.3 | NO | — |
| Kennedy Rd: Lawrence Ave E - Cornwallis Dr | ATR_VOLUME | 2019-09-19 | aging | 17952.9 | 08:30:00 (1200) | — (pair) | — | NO | — |
| Kennedy Rd: Flora Dr - Lawrence Ave E | ATR_VOLUME | 2019-09-19 | aging | 16379.1 | 08:00:00 (1158) | — (pair) | — | NO | — |
| Bobmar Rd: Military Trl - Walding Gt | ATR_SPEED_VOLUME | 2019-10-22 | aging | 599 | 08:00:00 (84) | 43921800#0 (pair) | 149.1 | NO | — |
| Heathfield Dr to Hill Cres (id: 110851) | ATR_SPEED_VOLUME | 2019-10-22 | aging | 229 | 08:30:00 (54) | -500279618#0 (pair) | 65.4 | NO | — |
| Brussels Rd: Huntington Ave - Winter Ave | ATR_SPEED_VOLUME | 2019-11-27 | aging | 562.5 | 08:00:00 (64) | — (pair) | — | NO | — |
| Pitfield Rd: Midland Ave - Marilake Dr | ATR_VOLUME | 2001-10-30 | stale | 1710 | 09:15:00 (87) | — (pair) | — | NO | — |
| Granard Blvd: Bare Rock Dr - Bellamy Rd S | ATR_SPEED_VOLUME | 2004-05-05 | stale | 153 | 06:30:00 (10) | -35798550 (pair) | 101.3 | NO | — |
| Adanac Dr: Granard Blvd - McCowan District Park Trl | ATR_SPEED_VOLUME | 2004-05-05 | stale | 328 | 07:30:00 (21) | — (pair) | — | NO | — |
| Marilake Dr: Manorglen Cres - Summerglade Dr | ATR_SPEED_VOLUME | 2004-10-06 | stale | 200 | 08:00:00 (21) | -36548461 (pair) | 136.0 | NO | — |
| Mansewood Gdns to Manse Rd | ATR_VOLUME | 2005-07-06 | stale | 128 | 06:30:00 (3) | -1191384224#1 (pair) | 141.6 | NO | — |
| Knowlton Dr: Lawndale Rd - Lochleven Dr | ATR_SPEED_VOLUME | 2005-10-05 | stale | 897 | 08:00:00 (84) | -548144835 (pair) | 73.3 | NO | — |
| Kennedy Rd: Treverton Dr - Landseer Rd | ATR_SPEED_VOLUME | 2006-03-22 | stale | 25290 | 07:30:00 (1559) | — (pair) | — | NO | — |
| Tams Rd to Bonspiel Dr | ATR_SPEED_VOLUME | 2007-05-02 | stale | 554 | 07:45:00 (124) | — (pair) | — | NO | — |
| Schmirler Ter to Bonspiel Dr | ATR_SPEED_VOLUME | 2007-05-02 | stale | 222 | 08:00:00 (22) | -632963007#31 (pair) | 103.1 | NO | — |
| Barbados Blvd to Eglinton Ave E | ATR_VOLUME | 2007-06-05 | stale | 1708 | 09:15:00 (107) | — (pair) | — | NO | — |
| Manse Rd: Lawrence Ave E - Chelmer Gt | ATR_VOLUME | 2007-09-25 | stale | 3598.7 | 07:30:00 (520) | 1191384224#0 (pair) | 72.2 | NO | — |
| Midwest Rd: West Birkdale Park Trl - Midland Ave | ATR_SPEED_VOLUME | 2007-10-16 | stale | 5635 | 06:30:00 (403) | -320464907#24 (pair) | 61.2 | NO | — |
| Great West Dr: De Jong St - Lane 2 S of Ellesmere and W of Great West | ATR_SPEED_VOLUME | 2007-10-16 | stale | 2031 | 06:45:00 (199) | — (pair) | — | NO | — |
| Kingston Rd: Mason Rd - Vasto Lane | ATR_SPEED_VOLUME | 2007-11-05 | stale | 46864 | 07:45:00 (3860) | — (pair) | — | NO | — |
| Dailing Gt: Milner Ave - 2 Dailing Gt | ATR_VOLUME | 2007-11-13 | stale | 3656 | 08:00:00 (321) | 35349330#0 (pair) | 64.5 | NO | — |
| Pitfield Rd: Marilake Dr - Manorglen Cres | ATR_VOLUME | 2008-05-13 | stale | 3477 | 08:15:00 (334) | — (pair) | — | NO | — |
| Dennett Dr: Marydon Cres - Lauralynn Cres | ATR_VOLUME | 2008-05-13 | stale | 1425 | 08:15:00 (232) | — (pair) | — | NO | — |
| Eglinton Ave E: Oswego Rd - Barbados Blvd | ATR_SPEED_VOLUME | 2008-07-30 | stale | 29666 | 08:15:00 (1618) | — (pair) | — | NO | — |
| Midland Ave: Hwy 401 Collectors W / Hwy 401 Express W - Emblem Crt | ATR_SPEED_VOLUME | 2009-04-08 | stale | 12170 | 08:15:00 (854) | 135952892#1 (pair) | 82.5 | NO | — |
| Colonial Ave: Little Rock Dr - Bellamy Rd S | ATR_SPEED_VOLUME | 2009-05-14 | stale | 417 | 08:15:00 (40) | — (pair) | — | NO | — |
| Adanac Dr: Little Rock Dr - Granard Blvd | ATR_SPEED_VOLUME | 2009-05-14 | stale | 602 | 08:00:00 (61) | — (pair) | — | NO | — |
| Colonial Ave: McCowan Rd - Adanac Dr | ATR_SPEED_VOLUME | 2009-05-14 | stale | 1374 | 08:00:00 (114) | — (pair) | — | NO | — |
| Manse Rd: Chelmer Gt - Kingston Rd | ATR_SPEED_VOLUME | 2009-11-10 | stale | 3261 | 07:30:00 (327) | — (pair) | — | NO | — |
| Treverton Dr: Sedgewick Cres - Oakworth Cres | ATR_SPEED_VOLUME | 2009-12-08 | stale | 594 | 07:45:00 (48) | — (pair) | — | NO | — |
| Treverton Dr to Moorecroft Cres | ATR_SPEED_VOLUME | 2009-12-08 | stale | 417 | 08:15:00 (35) | 35835519 (pair) | 144.5 | NO | — |
| Nantucket Blvd: Wickware Gt - Munham Gt | ATR_SPEED_VOLUME | 2010-03-11 | stale | 1185 | 07:45:00 (85) | — (pair) | — | NO | — |
| Martindale Rd: Rockwood Dr - Bellamy Rd S | ATR_SPEED_VOLUME | 2010-11-04 | stale | 364 | 08:30:00 (41) | — (pair) | — | NO | — |
| Martindale Rd: Lowell Ave - Rockwood Dr | ATR_SPEED_VOLUME | 2010-11-04 | stale | 505 | 08:00:00 (57) | — (pair) | — | NO | — |
| Bonspiel Dr to Tams Rd | ATR_SPEED_VOLUME | 2010-11-16 | stale | 57 | 08:15:00 (5) | -632963007#31 (pair) | 149.5 | NO | — |
| Pitfield Rd: Manorglen Cres - Midcroft Dr | ATR_SPEED_VOLUME | 2010-11-16 | stale | 3100 | 08:00:00 (353) | — (pair) | — | NO | — |
| Fitzgibbon Ave: Lord Roberts Dr - Marengo Ave | ATR_SPEED_VOLUME | 2010-11-16 | stale | 247 | 08:00:00 (21) | — (pair) | — | NO | — |
| Hainford St: Manse Rd - 20 Hainford St | ATR_SPEED_VOLUME | 2011-04-28 | stale | 318 | 08:00:00 (39) | — (pair) | — | NO | — |
| McCowan Rd: Bridlegrove Dr - Landmark Blvd | VEHICLE_CLASS | 2011-05-11 | stale | 8128 | 08:00:00 (604) | — (pair) | — | NO | — |
| Kingston Rd: Parkcrest Dr - Lochleven Dr | ATR_SPEED_VOLUME | 2011-06-15 | stale | 17688 | 08:00:00 (2392) | — (pair) | — | NO | — |
| 4315 Kingston Rd (id: 108693) | ATR_SPEED_VOLUME | 2011-06-21 | stale | 18242 | 08:00:00 (868) | 298209614#0 (pair) | 50.7 | NO | — |
| Radnor Ave: Porter Cres - Flora Dr | ATR_SPEED_VOLUME | 2011-09-13 | stale | 879 | 08:00:00 (89) | — (pair) | — | NO | — |
| Lawrence Ave E to Kennedy Rd | ATR_VOLUME | 2011-11-08 | stale | 23663.3 | 07:30:00 (2363) | — (pair) | — | NO | — |
| Lawrence Ave E: Manse Rd - Walkway E of Manse and N of Lawrence | ATR_VOLUME | 2011-11-08 | stale | 9140.3 | 07:30:00 (1065) | 1191384224#0 (pair) | 50.2 | NO | — |
| Morningside Ave: Military Trl - Tams Rd | ATR_VOLUME | 2011-12-06 | stale | 19603.7 | 08:30:00 (1204) | 876360320#0 (pair) | 72.5 | NO | — |
| Midland Ave: Canadine Rd - Ellesmere Rd | ATR_VOLUME | 2012-11-06 | stale | 19073.3 | 08:00:00 (1271) | -36783683#1 (pair) | 73.3 | NO | — |
| Midland Ave: Ellesmere Rd - Cosentino Dr | ATR_VOLUME | 2012-11-06 | stale | 14531 | 08:00:00 (1131) | 39210622#0 (pair) | 132.8 | NO | — |
| Midland Ave: Cosentino Dr - Progress Ave | ATR_VOLUME | 2012-11-06 | stale | 15679 | 08:00:00 (1117) | 25022809#0 (pair) | 92.8 | NO | — |
| Midland Ave: Town Haven Pl - Eglinton Ave E | ATR_VOLUME | 2012-11-06 | stale | 8152.7 | 08:15:00 (715) | — (pair) | — | NO | — |
| Midland Ave: Eglinton Ave E - Lord Roberts Dr | ATR_VOLUME | 2012-11-06 | stale | 23743.3 | 08:00:00 (1778) | — (pair) | — | NO | — |
| Ionview Rd: Landseer Rd - Midholm Dr | ATR_SPEED_VOLUME | 2013-02-05 | stale | 1428 | 08:00:00 (167) | — (pair) | — | NO | — |
| Bertrand Ave: Midholm Dr - Kennedy Rd | ATR_SPEED_VOLUME | 2013-02-05 | stale | 3597 | 08:00:00 (394) | — (pair) | — | NO | — |
| Eglinton Ave E: Midland Ave - Commonwealth Ave | ATR_VOLUME | 2013-03-26 | stale | 21718.3 | 08:00:00 (1917) | — (pair) | — | NO | — |
| Eglinton Ave E: Gilder Dr - Bimbrok Rd | ATR_VOLUME | 2013-03-26 | stale | 22111 | 07:45:00 (2087) | — (pair) | — | NO | — |
| Eglinton Ave E: Winter Ave - Gilder Dr | ATR_VOLUME | 2013-03-26 | stale | 20820.7 | 08:15:00 (962) | — (pair) | — | NO | — |
| Eglinton Ave E: Bimbrok Rd - Brimley Rd | ATR_VOLUME | 2013-03-26 | stale | 20584.3 | 08:15:00 (964) | — (pair) | — | NO | — |
| Eglinton Ave E: Danforth Rd - Oswego Rd | ATR_VOLUME | 2013-03-26 | stale | 20357.3 | 08:15:00 (1865) | — (pair) | — | NO | — |
| Eglinton Ave E: Brimley Rd - Danforth Rd | ATR_VOLUME | 2013-03-26 | stale | 35921 | 08:45:00 (2466) | 37229937#0 (pair) | 97.2 | NO | — |
| Kennedy Rd: Landseer Rd - Bertrand Ave | ATR_VOLUME | 2013-04-23 | stale | 14133.7 | 08:15:00 (932) | — (pair) | — | NO | — |
| Kennedy Rd: Gatineau Hydro Corridor Trl - Radnor Ave | ATR_VOLUME | 2013-04-23 | stale | 15528.3 | 08:00:00 (1058) | — (pair) | — | NO | — |
| Kennedy Rd: Bertrand Ave - Stratton Ave | ATR_VOLUME | 2013-04-23 | stale | 15036.3 | 08:15:00 (1081) | — (pair) | — | NO | — |
| Kingston Rd: Vasto Lane - Parkcrest Dr | ATR_VOLUME | 2013-09-24 | stale | 10989 | 07:15:00 (611) | — (pair) | — | NO | — |
| Kingston Rd: 3430 Kingston Rd - Markham Rd | ATR_VOLUME | 2013-09-24 | stale | 19741.7 | 08:15:00 (1093) | 48715757#0 (pair) | 84.3 | NO | — |
| Old Kingston Rd: Military Trl - Watson St | ATR_VOLUME | 2013-10-01 | stale | 6566.7 | 08:00:00 (898) | -227818179#2 (pair) | 106.9 | NO | — |
| Old Kingston Rd: Highland Creek Trl - Military Trl | ATR_VOLUME | 2013-10-01 | stale | 5343 | 08:30:00 (494) | 227818179#2 (pair) | 96.7 | NO | — |
| Kingston Rd: Manse Rd - Asterfield Dr | ATR_VOLUME | 2013-10-01 | stale | 19665.3 | 07:30:00 (2733) | 338407184#0 (pair) | 107.4 | NO | — |
| Kingston Rd: Orchard Park Dr - Manse Rd | ATR_VOLUME | 2013-10-01 | stale | 17536 | 08:15:00 (796) | -338407184#2 (pair) | 54.4 | NO | — |
| Kingston Rd: Beechgrove Dr - Hwy 2a E | ATR_VOLUME | 2013-10-03 | stale | 19830 | 07:30:00 (2583) | — (pair) | — | NO | — |
| Kingston Rd: 4662 Kingston Rd - Beechgrove Dr | ATR_VOLUME | 2013-10-03 | stale | 18037 | 08:15:00 (845) | — (pair) | — | NO | — |
| Brimley Rd: Boyce Ave - Danforth Rd | ATR_VOLUME | 2013-11-12 | stale | 7019.7 | 08:15:00 (669) | — (pair) | — | NO | — |
| Brimley Rd: Danforth Rd - Eglinton Ave E | ATR_VOLUME | 2013-11-12 | stale | 14818 | 08:15:00 (1185) | -37229937#0 (pair) | 136.6 | NO | — |
| Service Rd: Markham Rd - Lane E of Markham and S of Service | ATR_SPEED_VOLUME | 2013-11-26 | stale | 1305 | 07:45:00 (121) | 48715757#0 (pair) | 85.1 | NO | — |
| Sheppard Ave E: Glen Watford Dr - Harrisfarm Gt | ATR_VOLUME | 2014-04-22 | stale | 17014.3 | 08:00:00 (1550) | — (pair) | — | NO | — |
| Danforth Rd: Century Dr - Brimley Rd | ATR_VOLUME | 2014-05-20 | stale | 11010.7 | 08:15:00 (687) | — (pair) | — | NO | — |
| Danforth Rd: Brimley Rd - Horton Blvd | ATR_VOLUME | 2014-05-20 | stale | 9428.3 | 08:00:00 (849) | — (pair) | — | NO | — |
| Danforth Rd: Tyne Crt - Century Dr | ATR_VOLUME | 2014-05-20 | stale | 10509 | 08:30:00 (961) | — (pair) | — | NO | — |
| Ellesmere Rd to Midland Ave | ATR_VOLUME | 2014-09-16 | stale | 16688 | 08:45:00 (922) | 39210630#0 (pair) | 78.8 | NO | — |
| Markham Rd: Milner Ave - Rosebank Dr | ATR_VOLUME | 2014-09-20 | stale | 24859 | 08:15:00 (1800) | 227817710#0 (pair) | 52.9 | NO | — |
| Treverton Dr: Oakworth Cres - Moorecroft Cres | ATR_SPEED_VOLUME | 2014-11-19 | stale | 514 | 07:15:00 (32) | — (pair) | — | NO | — |
| Treverton Dr to Sedgewick Cres | ATR_SPEED_VOLUME | 2014-11-19 | stale | 623 | 09:00:00 (41) | — (pair) | — | NO | — |

## Unmatched in-corridor locations (196, of which 2 at the net boundary)
A location marked *net boundary* sits on a dead-end stub where the bbox clipped the cross street — the intersection exists in the city, not in this net. Those counts cannot constrain a junction of this net (though boundary counts could inform corridor INFLOWS in a later calibration step).
- TMC Pan Am Dr: Morningside Ave - Military Trl (2026-05-12, recent) — nearest edge none at >150 m
- TMC Ellesmere Rd / Bobmar Rd (2026-05-05, recent) — nearest junction 428477251 at 70.5 m
- TMC Neilson Rd / Gatineau Hydro Corridor Trl (2026-04-21, recent) — nearest junction 11749856482 at 68.2 m
- TMC Homestead Rd / Coronation Dr (2026-01-22, recent) — nearest junction 277490924 at 144.9 m
- TMC McCowan Rd / Bridlegrove Dr / McCowan District Park Trl (2025-11-22, recent) — nearest junction none at >150 m
- TMC Eglinton Ave E / Barbados Blvd (2025-11-22, recent) — nearest junction none at >150 m
- TMC Eglinton Ave E / Falmouth Ave / Gilder Dr (2025-11-22, recent) — nearest junction none at >150 m
- TMC Brimley Rd / Eglinton Ave E (2025-11-18, recent) — nearest junction 433599658 at 48.1 m
- TMC Markham Rd / Kingston Rd (2025-10-28, recent) — nearest junction 9349929996 at 66.1 m — **net boundary**
- TMC Sheppard Ave E / Shorting Rd (2025-10-19, recent) — nearest junction none at >150 m
- TMC Eglinton Ave E (id: 13452567) (2025-09-24, recent) — nearest junction none at >150 m
- TMC Asterfield Dr / Green Ash Ter (2025-08-26, recent) — nearest junction none at >150 m
- TMC Kennedy Rd / Lawrence Ave E (2025-06-25, recent) — nearest junction none at >150 m
- TMC Ellesmere Rd / Midland Ave (2025-06-25, recent) — nearest junction 469705485 at 95.7 m — **net boundary**
- TMC Kingston Rd / Whitecap Blvd (2025-06-17, recent) — nearest junction none at >150 m
- TMC Kingston Rd / Beechgrove Dr (2025-06-17, recent) — nearest junction none at >150 m
- TMC Kingston Rd / Mason Rd (2025-05-28, recent) — nearest junction none at >150 m
- TMC Midland Ave / Progress Ave (2024-11-24, recent) — nearest junction 32472833 at 58.6 m
- TMC Eglinton Ave E / Midland Ave (2024-11-24, recent) — nearest junction none at >150 m
- TMC Midland Ave / Gilder Dr / Lord Roberts Dr (2024-11-23, recent) — nearest junction 7224990925 at 74.8 m
- TMC Midland Ave / Midwest Rd (North) (2024-11-23, recent) — nearest junction 12870925072 at 46.6 m
- TMC Midland Ave / Emblem Crt (2024-11-23, recent) — nearest junction none at >150 m
- TMC Midland Ave / Wainfleet Rd / Broadbent Ave (2024-11-23, recent) — nearest junction none at >150 m
- TMC Brimley Rd / Walkway S of Sheppard and W of Brimley (2024-11-02, recent) — nearest junction 425644539 at 147.2 m
- TMC Danforth Rd / Neston Ave / Tyne Crt (2024-11-02, recent) — nearest junction none at >150 m
- TMC Danforth Rd / Eglinton Ave E (2024-11-02, recent) — nearest junction none at >150 m
- TMC Danforth Rd / Brimley Rd (2024-11-02, recent) — nearest junction none at >150 m
- TMC Kennedy Rd / Mike Myers Dr (2023-11-02, recent) — nearest junction none at >150 m
- TMC Military Trl / Bonspiel Dr (2023-06-01, recent) — nearest junction none at >150 m
- TMC Kennedy Rd / Stratton Ave / Kingsdown Dr (2023-05-10, recent) — nearest junction none at >150 m
- TMC Grantown Ave / Calverley Trl (2023-02-14, recent) — nearest junction none at >150 m
- TMC Ellesmere Rd / Morrish Rd (2022-12-17, recent) — nearest junction 428492020 at 34.1 m
- TMC Mason Rd / Knowlton Dr (2022-11-23, recent) — nearest junction 418523623 at 136.7 m
- TMC Radnor Ave / Flora Dr (2022-09-29, recent) — nearest junction none at >150 m
- TMC Kingston Rd / Parkcrest Dr (2022-06-01, recent) — nearest junction none at >150 m
- TMC Eglinton Ave E / Huntington Ave (2022-03-08, recent) — nearest junction none at >150 m
- TMC Old Kingston Rd / Military Trl (2022-02-24, recent) — nearest junction 296406087 at 89.8 m
- TMC Progress Ave: William Kitchen Rd - Midland Ave (2022-02-23, recent) — nearest edge none at >150 m
- TMC Glenthorne Dr / Watson St (2022-02-15, recent) — nearest junction none at >150 m
- TMC Manse Rd / Hainford St (2022-02-01, recent) — nearest junction none at >150 m
- TMC Hwy 401 / Hwy 401 Collectors E Brimley Ramp (2019-12-19, aging) — nearest junction 135952892#1-AddedOnRampNode at 76.8 m
- TMC Kennedy Rd / Landseer Rd (2019-12-18, aging) — nearest junction none at >150 m
- TMC Bobmar Rd / Military Trl (2019-01-09, aging) — nearest junction none at >150 m
- TMC Kennedy Rd / Radnor Ave (2019-01-08, aging) — nearest junction none at >150 m
- TMC Kennedy Rd / Ranstone Gdns / Jack Goodlad Park Trl (2018-12-19, aging) — nearest junction none at >150 m
- TMC Ionview Rd / Bertrand Ave (2018-10-31, aging) — nearest junction none at >150 m
- TMC Collinsgrove Rd / 55 Collinsgrove Rd (2018-05-30, aging) — nearest junction 842303151 at 123.4 m
- TMC Collinsgrove Rd / 25 Collinsgrove Rd (2018-05-24, aging) — nearest junction 32346406 at 147.2 m
- TMC Kennedy Rd / Cornwallis Dr (2017-11-28, aging) — nearest junction none at >150 m
- TMC Markham Rd / Rosebank Dr (2017-04-05, aging) — nearest junction none at >150 m
- TMC Milner Ave / Dailing Gt (2017-03-20, aging) — nearest junction 414466528 at 69.0 m
- TMC Kennedy Rd / Bertrand Ave (2015-07-23, aging) — nearest junction none at >150 m
- TMC Ellesmere Rd / Calverley Trl (2014-10-07, stale) — nearest junction none at >150 m
- TMC Nantucket Blvd / Wickware Gt (2010-03-03, stale) — nearest junction none at >150 m
- TMC Midland Ave / Goodland Gt (2009-04-15, stale) — nearest junction none at >150 m
- TMC Kingston Rd / 3430 Kingston Rd (2006-05-24, stale) — nearest junction none at >150 m
- TMC Kingston Rd / Lochleven Dr (2006-05-24, stale) — nearest junction none at >150 m
- TMC Triton Rd: Borough Dr - McCowan Rd (1985-04-17, stale) — nearest edge 190539058#0 at 88.4 m
- SVC Ionview Rd to Flempton Cres (2026-06-23, recent) — nearest edge none at >150 m
- SVC Ionview Rd: Corinne Cres - Landseer Rd (2026-06-23, recent) — nearest edge none at >150 m
- SVC Calverley Trl: Ellesmere Rd - Fishery Rd (2026-04-14, recent) — nearest edge 36855333#0 at 108.8 m
- SVC Homestead Rd: Darlingside Dr - Coronation Dr (2026-04-14, recent) — nearest edge -25372422#1 at 111.2 m
- SVC Homestead Rd: Coronation Dr - Skelding Crt (2026-04-14, recent) — nearest edge 39871989#0 at 109.9 m
- SVC Rosemount Dr: Maida Vale - Richome Crt (2026-04-14, recent) — nearest edge none at >150 m
- SVC Manse Rd: Grey Abbey Park Trl - Coronation Dr (2026-03-24, recent) — nearest edge -25372419#0 at 122.5 m
- SVC Manse Rd: Deanscroft Sq - 235 Manse Rd (2026-03-24, recent) — nearest edge 8162944#0 at 127.9 m
- SVC Bertrand Ave: Iondale Pl - Midholm Dr (2025-08-26, recent) — nearest edge none at >150 m
- SVC Ellesmere Rd to Zezel Way (2025-08-12, recent) — nearest edge none at >150 m
- SVC Ellesmere Rd: Zezel Way - Great West Dr (2025-08-12, recent) — nearest edge none at >150 m
- SVC Broadbent Ave: Midland Ave - Chipper Cres (2025-01-07, recent) — nearest edge -35796837#1 at 61.9 m
- SVC Wetherby Dr: Brimley Rd - Shaddock Cres (2024-12-17, recent) — nearest edge 35798445#0 at 87.1 m
- SVC Ranstone Gdns: Givendale Rd - Kingsdown Dr (2024-10-01, recent) — nearest edge none at >150 m
- SVC Ionview Rd: Flempton Cres - Yorkshire Rd (2024-02-27, recent) — nearest edge none at >150 m
- SVC Watson St: Glenthorne Dr - Wishaw Rd (2023-12-05, recent) — nearest edge none at >150 m
- SVC Watson St: Wishaw Rd - Walkway S of Ellesmere and W of Watson (2023-12-05, recent) — nearest edge none at >150 m
- SVC Watson St: Old Kingston Rd - Thomas Ave (2023-12-05, recent) — nearest edge -227818179#2 at 145.8 m
- SVC Boyce Ave: Brimley Rd - Oswego Rd (2023-11-07, recent) — nearest edge none at >150 m
- SVC Kingsdown Dr: Kennedy Rd - Yorkshire Rd (2023-11-07, recent) — nearest edge none at >150 m
- SVC Kingsdown Dr: Yorkshire Rd - Ranstone Gdns (2023-11-07, recent) — nearest edge none at >150 m
- SVC Kennedy Rd: Radnor Ave - Mike Myers Dr (2023-10-31, recent) — nearest edge none at >150 m
- SVC Morrish Rd: Ellesmere Rd - Grantown Ave (2023-08-01, recent) — nearest edge 36855333#0 at 144.1 m
- SVC Lawrence Ave E: Wildflower Way - Valia Rd (2023-08-01, recent) — nearest edge none at >150 m
- SVC Eglinton Ave E to Hydro Corridor (2023-05-09, recent) — nearest edge none at >150 m
- SVC Kennedy Rd: Stratton Ave - Jack Goodlad Park Trl (2023-05-09, recent) — nearest edge -1503074455 at 131.6 m
- SVC Markham Rd: Shirley Cres - Service Rd (2023-03-21, recent) — nearest edge none at >150 m
- SVC Markham Rd: Hill Cres - Shirley Cres (2023-03-21, recent) — nearest edge none at >150 m
- SVC Oakridge Dr: Rockwood Dr - Cree Ave (2023-03-21, recent) — nearest edge none at >150 m
- SVC Hill Cres: Duncombe Blvd - Heathfield Dr (2023-01-10, recent) — nearest edge -500279618#0 at 131.1 m
- SVC Hill Cres: Brinloor Blvd - Duncombe Blvd (2023-01-10, recent) — nearest edge none at >150 m
- SVC Kingston Rd: Lochleven Dr - 3430 Kingston Rd (2022-05-31, recent) — nearest edge none at >150 m
- SVC Kingston Rd: Tollgate Mews - Whitecap Blvd (2022-05-31, recent) — nearest edge 35798550 at 142.8 m
- SVC Heather Rd: Lane W of Shilton and N of Heather Rd - Shilton Rd (2022-04-05, recent) — nearest edge none at >150 m
- SVC Maretta Ave: Khartoum Ave - Rutledge Ave (2022-03-22, recent) — nearest edge none at >150 m
- SVC Duncombe Blvd: Brinloor Blvd - Shirley Cres (2021-11-30, recent) — nearest edge -35798517 at 114.0 m
- SVC Manse Rd: Hainford St - Mansewood Gdns (2021-11-30, recent) — nearest edge none at >150 m
- SVC Gilder Dr: Midland Ave - Eglinton Ave E (2021-07-20, recent) — nearest edge 232196664#0 at 142.8 m
- SVC Brussels Rd: Winter Ave - Falmouth Ave (2020-09-29, recent) — nearest edge none at >150 m
- SVC Keeler Blvd to Sandrift Sq (2020-01-28, recent) — nearest edge -36861136 at 90.7 m
- SVC Brussels Rd: Huntington Ave - Winter Ave (2019-11-27, aging) — nearest edge none at >150 m
- SVC Bobmar Rd: Military Trl - Walding Gt (2019-10-22, aging) — nearest edge 43921800#0 at 149.1 m
- SVC Heathfield Dr to Hill Cres (id: 110851) (2019-10-22, aging) — nearest edge -500279618#0 at 65.4 m
- SVC Eglinton Ave E: McCowan Rd - Torrance Rd (2019-09-19, aging) — nearest edge 22486528#12 at 127.6 m
- SVC Eglinton Ave E: Barbados Blvd - McCowan Rd (2019-09-19, aging) — nearest edge 330602795#0 at 129.3 m
- SVC Kennedy Rd: Lawrence Ave E - Cornwallis Dr (2019-09-19, aging) — nearest edge none at >150 m
- SVC Kennedy Rd: Flora Dr - Lawrence Ave E (2019-09-19, aging) — nearest edge none at >150 m
- SVC Eglinton Ave E: Commonwealth Ave - Huntington Ave (2019-09-18, aging) — nearest edge none at >150 m
- SVC Bimbrok Rd: Eglinton Ave E - Gadsby Dr (2019-06-25, aging) — nearest edge -35835538 at 108.9 m
- SVC Bertrand Ave: Lozoway Dr - Ionview Rd (2019-04-16, aging) — nearest edge none at >150 m
- SVC Lozoway Dr: Bertrand Ave - Hardcastle St (2019-04-16, aging) — nearest edge none at >150 m
- SVC Keeler Blvd: Sandrift Sq - Edenmills Dr (2018-03-27, aging) — nearest edge -36861136 at 90.0 m
- SVC Neilson Rd to Oakmeadow Blvd (2017-11-08, aging) — nearest edge -36861150#2 at 66.0 m
- SVC Midland Ave: Progress Ave - Hwy 401 Collectors W / Hwy 401 Express W (2017-10-18, aging) — nearest edge none at >150 m
- SVC Danforth Rd: Eglinton Ave E - No Frills Lane (2017-05-09, aging) — nearest edge none at >150 m
- SVC Danforth Rd: Horton Blvd - Eglinton Ave E (2017-05-09, aging) — nearest edge none at >150 m
- SVC Eglinton Ave E to Midland Ave (2017-01-26, aging) — nearest edge none at >150 m
- SVC McCowan Rd: Sheppard Ave E - Nugget Ave (2016-01-30, aging) — nearest edge 36921179#0 at 74.3 m
- SVC Great West Dr: Lane 2 S of Ellesmere and W of Great West - Kawneer Ter (2015-06-30, aging) — nearest edge none at >150 m
- SVC Kawneer Ter: Zezel Way - Great West Dr (2015-06-30, aging) — nearest edge none at >150 m
- SVC De Jong St: Zezel Way - Great West Dr (2015-06-30, aging) — nearest edge none at >150 m
- SVC Zezel Way: Kawneer Ter - Lane 2 S of Ellesmere and W of Great West (2015-06-30, aging) — nearest edge none at >150 m
- SVC Mason Rd: Greendowns Dr - Stanland Dr (2015-04-15, aging) — nearest edge 43328162#0 at 79.0 m
- SVC Falmouth Ave: Brussels Rd - Century Dr (2015-03-11, aging) — nearest edge none at >150 m
- SVC Treverton Dr: Oakworth Cres - Moorecroft Cres (2014-11-19, stale) — nearest edge none at >150 m
- SVC Treverton Dr to Sedgewick Cres (2014-11-19, stale) — nearest edge none at >150 m
- SVC Markham Rd: Milner Ave - Rosebank Dr (2014-09-20, stale) — nearest edge 227817710#0 at 52.9 m
- SVC Ellesmere Rd to Midland Ave (2014-09-16, stale) — nearest edge 39210630#0 at 78.8 m
- SVC Danforth Rd: Century Dr - Brimley Rd (2014-05-20, stale) — nearest edge none at >150 m
- SVC Danforth Rd: Brimley Rd - Horton Blvd (2014-05-20, stale) — nearest edge none at >150 m
- SVC Danforth Rd: Tyne Crt - Century Dr (2014-05-20, stale) — nearest edge none at >150 m
- SVC Sheppard Ave E: Glen Watford Dr - Harrisfarm Gt (2014-04-22, stale) — nearest edge none at >150 m
- SVC Service Rd: Markham Rd - Lane E of Markham and S of Service (2013-11-26, stale) — nearest edge 48715757#0 at 85.1 m
- SVC Brimley Rd: Boyce Ave - Danforth Rd (2013-11-12, stale) — nearest edge none at >150 m
- SVC Brimley Rd: Danforth Rd - Eglinton Ave E (2013-11-12, stale) — nearest edge -37229937#0 at 136.6 m
- SVC Kingston Rd: Beechgrove Dr - Hwy 2a E (2013-10-03, stale) — nearest edge none at >150 m
- SVC Kingston Rd: 4662 Kingston Rd - Beechgrove Dr (2013-10-03, stale) — nearest edge none at >150 m
- SVC Old Kingston Rd: Military Trl - Watson St (2013-10-01, stale) — nearest edge -227818179#2 at 106.9 m
- SVC Old Kingston Rd: Highland Creek Trl - Military Trl (2013-10-01, stale) — nearest edge 227818179#2 at 96.7 m
- SVC Kingston Rd: Manse Rd - Asterfield Dr (2013-10-01, stale) — nearest edge 338407184#0 at 107.4 m
- SVC Kingston Rd: Orchard Park Dr - Manse Rd (2013-10-01, stale) — nearest edge -338407184#2 at 54.4 m
- SVC Kingston Rd: Vasto Lane - Parkcrest Dr (2013-09-24, stale) — nearest edge none at >150 m
- SVC Kingston Rd: 3430 Kingston Rd - Markham Rd (2013-09-24, stale) — nearest edge 48715757#0 at 84.3 m
- SVC Kennedy Rd: Landseer Rd - Bertrand Ave (2013-04-23, stale) — nearest edge none at >150 m
- SVC Kennedy Rd: Gatineau Hydro Corridor Trl - Radnor Ave (2013-04-23, stale) — nearest edge none at >150 m
- SVC Kennedy Rd: Bertrand Ave - Stratton Ave (2013-04-23, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Midland Ave - Commonwealth Ave (2013-03-26, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Gilder Dr - Bimbrok Rd (2013-03-26, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Winter Ave - Gilder Dr (2013-03-26, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Bimbrok Rd - Brimley Rd (2013-03-26, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Danforth Rd - Oswego Rd (2013-03-26, stale) — nearest edge none at >150 m
- SVC Eglinton Ave E: Brimley Rd - Danforth Rd (2013-03-26, stale) — nearest edge 37229937#0 at 97.2 m
- SVC Ionview Rd: Landseer Rd - Midholm Dr (2013-02-05, stale) — nearest edge none at >150 m
- SVC Bertrand Ave: Midholm Dr - Kennedy Rd (2013-02-05, stale) — nearest edge none at >150 m
- SVC Midland Ave: Canadine Rd - Ellesmere Rd (2012-11-06, stale) — nearest edge -36783683#1 at 73.3 m
- SVC Midland Ave: Ellesmere Rd - Cosentino Dr (2012-11-06, stale) — nearest edge 39210622#0 at 132.8 m
- SVC Midland Ave: Cosentino Dr - Progress Ave (2012-11-06, stale) — nearest edge 25022809#0 at 92.8 m
- SVC Midland Ave: Town Haven Pl - Eglinton Ave E (2012-11-06, stale) — nearest edge none at >150 m
- SVC Midland Ave: Eglinton Ave E - Lord Roberts Dr (2012-11-06, stale) — nearest edge none at >150 m
- SVC Morningside Ave: Military Trl - Tams Rd (2011-12-06, stale) — nearest edge 876360320#0 at 72.5 m
- SVC Lawrence Ave E to Kennedy Rd (2011-11-08, stale) — nearest edge none at >150 m
- SVC Lawrence Ave E: Manse Rd - Walkway E of Manse and N of Lawrence (2011-11-08, stale) — nearest edge 1191384224#0 at 50.2 m
- SVC Radnor Ave: Porter Cres - Flora Dr (2011-09-13, stale) — nearest edge none at >150 m
- SVC 4315 Kingston Rd (id: 108693) (2011-06-21, stale) — nearest edge 298209614#0 at 50.7 m
- SVC Kingston Rd: Parkcrest Dr - Lochleven Dr (2011-06-15, stale) — nearest edge none at >150 m
- SVC McCowan Rd: Bridlegrove Dr - Landmark Blvd (2011-05-11, stale) — nearest edge none at >150 m
- SVC Hainford St: Manse Rd - 20 Hainford St (2011-04-28, stale) — nearest edge none at >150 m
- SVC Bonspiel Dr to Tams Rd (2010-11-16, stale) — nearest edge -632963007#31 at 149.5 m
- SVC Pitfield Rd: Manorglen Cres - Midcroft Dr (2010-11-16, stale) — nearest edge none at >150 m
- SVC Fitzgibbon Ave: Lord Roberts Dr - Marengo Ave (2010-11-16, stale) — nearest edge none at >150 m
- SVC Martindale Rd: Rockwood Dr - Bellamy Rd S (2010-11-04, stale) — nearest edge none at >150 m
- SVC Martindale Rd: Lowell Ave - Rockwood Dr (2010-11-04, stale) — nearest edge none at >150 m
- SVC Nantucket Blvd: Wickware Gt - Munham Gt (2010-03-11, stale) — nearest edge none at >150 m
- SVC Treverton Dr: Sedgewick Cres - Oakworth Cres (2009-12-08, stale) — nearest edge none at >150 m
- SVC Treverton Dr to Moorecroft Cres (2009-12-08, stale) — nearest edge 35835519 at 144.5 m
- SVC Manse Rd: Chelmer Gt - Kingston Rd (2009-11-10, stale) — nearest edge none at >150 m
- SVC Colonial Ave: Little Rock Dr - Bellamy Rd S (2009-05-14, stale) — nearest edge none at >150 m
- SVC Adanac Dr: Little Rock Dr - Granard Blvd (2009-05-14, stale) — nearest edge none at >150 m
- SVC Colonial Ave: McCowan Rd - Adanac Dr (2009-05-14, stale) — nearest edge none at >150 m
- SVC Midland Ave: Hwy 401 Collectors W / Hwy 401 Express W - Emblem Crt (2009-04-08, stale) — nearest edge 135952892#1 at 82.5 m
- SVC Eglinton Ave E: Oswego Rd - Barbados Blvd (2008-07-30, stale) — nearest edge none at >150 m
- SVC Pitfield Rd: Marilake Dr - Manorglen Cres (2008-05-13, stale) — nearest edge none at >150 m
- SVC Dennett Dr: Marydon Cres - Lauralynn Cres (2008-05-13, stale) — nearest edge none at >150 m
- SVC Dailing Gt: Milner Ave - 2 Dailing Gt (2007-11-13, stale) — nearest edge 35349330#0 at 64.5 m
- SVC Kingston Rd: Mason Rd - Vasto Lane (2007-11-05, stale) — nearest edge none at >150 m
- SVC Midwest Rd: West Birkdale Park Trl - Midland Ave (2007-10-16, stale) — nearest edge -320464907#24 at 61.2 m
- SVC Great West Dr: De Jong St - Lane 2 S of Ellesmere and W of Great West (2007-10-16, stale) — nearest edge none at >150 m
- SVC Manse Rd: Lawrence Ave E - Chelmer Gt (2007-09-25, stale) — nearest edge 1191384224#0 at 72.2 m
- SVC Barbados Blvd to Eglinton Ave E (2007-06-05, stale) — nearest edge none at >150 m
- SVC Tams Rd to Bonspiel Dr (2007-05-02, stale) — nearest edge none at >150 m
- SVC Schmirler Ter to Bonspiel Dr (2007-05-02, stale) — nearest edge -632963007#31 at 103.1 m
- SVC Kennedy Rd: Treverton Dr - Landseer Rd (2006-03-22, stale) — nearest edge none at >150 m
- SVC Knowlton Dr: Lawndale Rd - Lochleven Dr (2005-10-05, stale) — nearest edge -548144835 at 73.3 m
- SVC Mansewood Gdns to Manse Rd (2005-07-06, stale) — nearest edge -1191384224#1 at 141.6 m
- SVC Marilake Dr: Manorglen Cres - Summerglade Dr (2004-10-06, stale) — nearest edge -36548461 at 136.0 m
- SVC Granard Blvd: Bare Rock Dr - Bellamy Rd S (2004-05-05, stale) — nearest edge -35798550 at 101.3 m
- SVC Adanac Dr: Granard Blvd - McCowan District Park Trl (2004-05-05, stale) — nearest edge none at >150 m
- SVC Pitfield Rd: Midland Ave - Marilake Dr (2001-10-30, stale) — nearest edge none at >150 m
- Rows with null/zero coordinates (whole dataset, unbboxable): TMC 0, SVC 0

## Histograms
- TMC recency: aging=58, recent=247, stale=38
- TMC match distance: <10m=271, <20m=13, <30m=1, <45m=1, <150m=17, >150m/none=40
- SVC recency: aging=100, recent=254, stale=432
- SVC match distance: <10m=627, <20m=9, <30m=5, <45m=7, <150m=51, >150m/none=87
- Co-located TMC/SVC pairs (<25 m): 35 (context only — an intersection TMC and a midblock SVC measure different things)

## AM-peak calibration coverage — verdict data
- TMC intersections in-corridor: **324**; matched to a net junction: **269** (of the unmatched, 2 sit at the net's clipped boundary — real intersections the net does not model; potential inflow references, never junction constraints).
- Of the matched, counts whose raw 15-min bins **fully cover 07:00–09:00, post-2020** (the set an AM-peak calibration would stand on): **126**.
- Additionally, matched post-2020 counts covering the window only PARTIALLY: **73** at 6/8 slots (the city's standard 8-hour counts start 07:30, so 6/8 = 07:30–09:00 covered — usable if the calibrated window narrows, stated as such).
  - Brimley Rd / Heather Rd — junction 268735945, counted 2024-11-02 (AM bins on 2024-11-02)
  - Midland Ave / Millbridge Gt — junction 272059697, counted 2024-12-18 (AM bins on 2024-12-18)
  - Brimley Rd / Sheppard Ave E — junction cluster_764519750_764519772_764519774_764519776, counted 2024-11-02 (AM bins on 2024-11-02)
  - Midland Ave / Dorcot Ave — junction 266298477, counted 2024-11-23 (AM bins on 2024-11-23)
  - Brimley Rd / Pitfield Rd — junction 258017384, counted 2024-11-02 (AM bins on 2024-11-02)
  - Midland Ave / Brockley Dr — junction 11591354578, counted 2024-11-23 (AM bins on 2024-11-23)
  - Lawrence Ave E / Midland Ave — junction cluster_414411286_414457402_469627192_469627202, counted 2025-07-03 (AM bins on 2025-07-03)
  - Midland Ave / Prudential Dr — junction cluster_134185914_7450278104, counted 2024-11-23 (AM bins on 2024-11-23)
  - Brimley Rd / Progress Ave — junction cluster_648905220_648905225_648905395_648905399, counted 2026-05-05 (AM bins on 2026-05-05)
  - Midland Ave / Marcos Blvd / Romulus Dr — junction 127755975, counted 2024-11-23 (AM bins on 2024-11-23)
  - Sheppard Ave E / Brownspring Rd — junction 258019366, counted 2024-10-30 (AM bins on 2024-10-30)
  - Lawrence Ave E / Brockley Dr — junction cluster_134189341_8279525552, counted 2023-09-19 (AM bins on 2023-09-19)
  - Brimley Rd / Triton Rd — junction cluster_297565688_297565703, counted 2025-07-03 (AM bins on 2025-07-03)
  - Brimley Rd / Omni Dr / Golden Gate Crt — junction 266292947, counted 2024-11-02 (AM bins on 2024-11-02)
  - Midland Ave / Stansbury Cres — junction 418514407, counted 2024-11-23 (AM bins on 2024-11-23)
  - Ellesmere Rd / Brimley Rd — junction cluster_13722262591_13722262592_13722262593_13722262594, counted 2025-06-25 (AM bins on 2025-06-25)
  - Midland Ave / Lord Roberts Dr — junction 245027598, counted 2024-03-06 (AM bins on 2024-03-06)
  - Brimley Rd / Applefield Dr / Bernadine St — junction 32474180, counted 2024-11-02 (AM bins on 2024-11-02)
  - Borough Dr / Omni Dr — junction cluster_297561913_297561952_32476101_32476102_#1more, counted 2026-01-29 (AM bins on 2026-01-29)
  - Brimley Rd / Waterfield Dr / Brimorton Dr — junction 272056708, counted 2024-11-02 (AM bins on 2024-11-02)
  - McCowan Rd / Sheppard Ave E — junction cluster_429374813_429374814_429374818_429374823, counted 2025-10-19 (AM bins on 2025-10-19)
  - Brimley Rd / St Andrews Rd / Applefield Dr — junction 32474182, counted 2024-11-02 (AM bins on 2024-11-02)
  - Ellesmere Rd / Borough Approach W — junction cluster_297561822_427685525_427685527, counted 2025-06-25 (AM bins on 2025-06-25)
  - McCowan Rd / Pitfield Rd / Invergordon Ave — junction cluster_429374811_429374827, counted 2024-10-16 (AM bins on 2024-10-16)
  - Brimley Rd / Dorcot Ave / Thomson Memorial Park Trl — junction 266298287, counted 2024-11-02 (AM bins on 2024-11-02)
  - McCowan Rd / Milner Ave / Channel Nine Crt — junction cluster_356949804_429374545, counted 2024-10-16 (AM bins on 2024-10-16)
  - Hwy 401 Collectors W Mccowan Rd Ramp / Hwy 401 Collectors W Ramp / McCowan Rd / Mccowan Rd S — junction cluster_32474466_32474467, counted 2024-11-12 (AM bins on 2024-11-12)
  - Progress Ave / Corporate Dr — junction cluster_414467162_414468957, counted 2024-04-21 (AM bins on 2024-04-21)
  - Brimley Rd / Lawrence Ave E / Gatineau Hydro Corridor Trl — junction 32474189, counted 2025-07-03 (AM bins on 2025-07-03)
  - Borough Dr / Town Centre Crt (South) — junction cluster_32476043_32476081, counted 2026-01-29 (AM bins on 2026-01-29)
  - Consilium Pl / Hwy 401 Collectors E Mccowan Rd Ramp / McCowan Rd — junction cluster_32472336_648921944, counted 2024-11-13 (AM bins on 2024-11-13)
  - Ellesmere Rd / Saratoga Dr — junction cluster_276486026_427653445, counted 2024-12-18 (AM bins on 2024-12-18)
  - Borough Dr / Town Centre Crt (North) — junction 32476071, counted 2025-12-11 (AM bins on 2025-12-11)
  - Brimley Rd / Shediac Rd / Fraserton Gt — junction 59360644, counted 2024-11-02 (AM bins on 2024-11-02)
  - Corporate Dr / Hwy 401 Collectors E Ramp — junction cluster_32474412_648917567, counted 2024-04-21 (AM bins on 2024-04-21)
  - McCowan Rd / Bushby Dr / Town Centre Crt — junction cluster_32476072_648921963_648921972_648921974, counted 2024-10-29 (AM bins on 2024-10-29)
  - Brimley Rd / Deerfield Rd — junction 418979773, counted 2024-11-02 (AM bins on 2024-11-02)
  - Lawrence Ave E / Barrymore Rd — junction 427731061, counted 2024-10-22 (AM bins on 2024-10-22)
  - Ellesmere Rd / McCowan Rd — junction cluster_13722263967_13722263968_13722263969_13722263970, counted 2025-06-25 (AM bins on 2025-06-25)
  - Brimley Rd / Gully Dr / Knob Hill Park Trl — junction 418982515, counted 2026-04-09 (AM bins on 2026-04-09)
  - Consilium Pl / Corporate Dr — junction cluster_1367253549_1367253551_1367253558_1367253561, counted 2024-10-29 (AM bins on 2024-10-29)
  - Brimley Rd / Citadel Dr — junction 127757162, counted 2023-10-12 (AM bins on 2023-10-12)
  - Brimley Rd / Elgar Ave / Dallyn Cres — junction 258022227, counted 2024-12-18 (AM bins on 2024-12-18)
  - Brimley Rd / Chillery Ave — junction 127757334, counted 2024-11-02 (AM bins on 2024-11-02)
  - McCowan Rd / Brimorton Dr — junction 427658932, counted 2024-06-11 (AM bins on 2024-06-11)
  - Lee Centre Dr / Corporate Dr / Lee Centre Park Trl — junction 306312329, counted 2024-04-21 (AM bins on 2024-04-21)
  - Lawrence Ave E / Valparaiso Ave — junction 427728885, counted 2025-05-21 (AM bins on 2025-05-21)
  - Danforth Rd / Trudelle St — junction 418523271, counted 2024-11-02 (AM bins on 2024-11-02)
  - Danforth Rd / Savarin St — junction 32496583, counted 2024-11-02 (AM bins on 2024-11-02)
  - Danforth Rd / Seminole Ave — junction 418980085, counted 2024-11-02 (AM bins on 2024-11-02)
  - Danforth Rd / Barrymore Rd — junction 266901178, counted 2024-11-02 (AM bins on 2024-11-02)
  - Perivale Cres / Dignam Crt — junction 278359874, counted 2026-02-19 (AM bins on 2026-02-19)
  - Milner Ave / Mid-Dominion Acres / Executive Crt — junction 257892178, counted 2025-08-06 (AM bins on 2025-08-06)
  - Amberjack Blvd / Bellamy Rd N / Lynnbrook Dr — junction 134209636, counted 2026-02-19 (AM bins on 2026-02-19)
  - Lawrence Ave E / Burnview Cres — junction 1430604103, counted 2025-05-21 (AM bins on 2025-05-21)
  - Bellamy Rd N / Northleigh Dr — junction 427658763, counted 2026-06-16 (AM bins on 2026-06-16)
  - McCowan Rd / Trudelle St — junction 266261617, counted 2025-11-22 (AM bins on 2025-11-22)
  - Eglinton Ave E / McCowan Rd — junction 241327103, counted 2024-10-19 (AM bins on 2024-10-19)
  - Markham Rd / Milner Ave — junction cluster_257892052_257892053_65238151_65238305, counted 2024-06-13 (AM bins on 2024-06-13)
  - Bellamy Rd N / Painted Post Dr — junction 427659012, counted 2024-12-11 (AM bins on 2024-12-11)
  - Rochman Blvd / Bellamy Rd N / Ben Alder Dr — junction 281308180, counted 2026-04-28 (AM bins on 2026-04-28)
  - Amberjack Blvd / Brimorton Dr — junction 427658354, counted 2025-03-19 (AM bins on 2025-03-19)
  - Lawrence Ave E / Bellamy Rd N — junction cluster_544177060_544177062_544177064_544177065, counted 2025-05-21 (AM bins on 2025-05-21)
  - Eglinton Ave E / Torrance Rd — junction 11224161610, counted 2025-11-22 (AM bins on 2025-11-22)
  - Cedar Brae Blvd / Banmoor Blvd / Bellamy Rd N — junction 266261971, counted 2025-05-28 (AM bins on 2025-05-28)
  - Lawrence Ave E / Greenbrae Crct / Greencedar Crct — junction 134219967, counted 2024-10-22 (AM bins on 2024-10-22)
  - Markham Rd / Tuxedo Crt — junction cluster_292958354_8713098229, counted 2024-09-11 (AM bins on 2024-09-11)
  - Eglinton Ave E / Bellamy Rd N — junction cluster_13284225813_13284225814_433591082_433591083, counted 2025-11-22 (AM bins on 2025-11-22)
  - Bellamy Rd N / Amarillo Dr — junction 418523858, counted 2025-05-28 (AM bins on 2025-05-28)
  - Bellamy Rd N / Nelson St — junction 418980459, counted 2025-11-22 (AM bins on 2025-11-22)
  - Bellamy Rd N / Porchester Dr — junction 266261662, counted 2025-11-11 (AM bins on 2025-11-11)
  - Farmbrook Rd / Nelson St — junction 418980436, counted 2026-04-14 (AM bins on 2026-04-14)
  - Adanac Dr / Bellamy Rd S / McCowan District Park Trl — junction 418523721, counted 2025-05-28 (AM bins on 2025-05-28)
  - Farmbrook Rd / Porchester Dr — junction 418980406, counted 2026-02-19 (AM bins on 2026-02-19)
  - Markham Rd / Rochman Blvd — junction 427659366, counted 2025-10-07 (AM bins on 2025-10-07)
  - Markham Rd / Greenbrae Crct / Greenholm Crct — junction 143985919, counted 2024-07-03 (AM bins on 2024-07-03)
  - Porchester Dr / Nelson St — junction 259698521, counted 2026-02-19 (AM bins on 2026-02-19)
  - Markham Rd / Lawrence Ave E — junction cluster_427773214_427773222_427773228_427773233, counted 2024-03-26 (AM bins on 2024-03-26)
  - Eglinton Ave E / Mason Rd — junction cluster_3524717298_3524717300_433591055_433591057_#1more, counted 2025-11-22 (AM bins on 2025-11-22)
  - Bakerton Dr / Porchester Dr — junction 418980412, counted 2026-02-19 (AM bins on 2026-02-19)
  - Markham Rd / Greencedar Crct / Greencrest Crct — junction cluster_427758711_427773231, counted 2024-07-03 (AM bins on 2024-07-03)
  - Mason Rd / Adanac Dr — junction 241338706, counted 2025-05-28 (AM bins on 2025-05-28)
  - Lawrence Ave E / Greenholm Crct / Greencrest Crct — junction 59834168, counted 2024-10-22 (AM bins on 2024-10-22)
  - Markham Rd / 435 Markham Rd / Blakemanor Blvd — junction 266262066, counted 2026-05-05 (AM bins on 2026-05-05)
  - Eglinton Ave E / Beachell St — junction 241342332, counted 2025-11-22 (AM bins on 2025-11-22)
  - Brimorton Dr / Painted Post Dr — junction 427756564, counted 2023-12-06 (AM bins on 2023-12-06)
  - Lochleven Dr / Knowlton Dr / Coltbridge Crt — junction 418523575, counted 2025-10-21 (AM bins on 2025-10-21)
  - Janray Dr / Fortune Gt — junction 427757443, counted 2025-01-28 (AM bins on 2025-01-28)
  - Lawrence Ave E / Fortune Gt — junction cluster_427760918_427761463, counted 2026-06-30 (AM bins on 2026-06-30)
  - Markham Rd / Luella St — junction 266262552, counted 2025-11-22 (AM bins on 2025-11-22)
  - Markham Rd / Eglinton Ave E — junction cluster_433591041_433591047_433591049_433591050, counted 2024-10-19 (AM bins on 2024-10-19)
  - Markham Rd / Markanna Dr — junction 266264574, counted 2025-11-22 (AM bins on 2025-11-22)
  - Ellesmere Rd / Orton Park Rd / Military Trl / Hydro Corridor — junction 59834332, counted 2024-02-28 (AM bins on 2024-02-28)
  - Lawrence Ave E / Scarborough Golf Club Rd — junction cluster_427756971_427760272_427760649_427761298, counted 2024-10-22 (AM bins on 2024-10-22)
  - Eglinton Ave E / Cedar Dr — junction cluster_241343614_433592698, counted 2025-11-22 (AM bins on 2025-11-22)
  - Highcastle Rd / Oakmeadow Blvd (South) — junction 428587898, counted 2023-10-17 (AM bins on 2023-10-17)
  - Kingston Rd / Eglinton Ave E — junction cluster_32458166_32458168_433592702, counted 2025-11-22 (AM bins on 2025-11-22)
  - Neilson Rd / Keeler Blvd / Oakmeadow Blvd — junction 293051697, counted 2025-10-26 (AM bins on 2025-10-26)
  - Lawrence Ave E / Mossbank Dr — junction 59834239, counted 2026-06-30 (AM bins on 2026-06-30)
  - Kingston Rd / Scarborough Golf Club Rd — junction cluster_137437710_137437716, counted 2025-11-22 (AM bins on 2025-11-22)
  - Neilson Rd / Military Trl — junction 32376758, counted 2025-10-16 (AM bins on 2025-10-16)
  - Orton Park Rd / Thornbeck Dr — junction 427761433, counted 2024-03-06 (AM bins on 2024-03-06)
  - Neilson Rd / Livonia Pl / Purpledusk Trl — junction 32348006, counted 2025-10-26 (AM bins on 2025-10-26)
  - Kingston Rd / Cromwell Rd / Guildwood Pkwy — junction cluster_32412880_33513422_33513448, counted 2024-06-19 (AM bins on 2024-06-19)
  - Lawrence Ave E / Orton Park Rd — junction cluster_427757616_427761342, counted 2026-06-30 (AM bins on 2026-06-30)
  - Ellesmere Rd / Neilson Rd — junction cluster_427761610_428591834, counted 2025-10-26 (AM bins on 2025-10-26)
  - Lawrence Ave E / Overture Rd — junction 33510585, counted 2026-06-30 (AM bins on 2026-06-30)
  - Livingston Rd / Guildwood Pkwy — junction cluster_33512745_33512850, counted 2024-10-08 (AM bins on 2024-10-08)
  - Lawrence Ave E / Galloway Rd — junction cluster_427820922_427820923, counted 2024-10-22 (AM bins on 2024-10-22)
  - Ellesmere Rd / Mornelle Crt — junction 296403598, counted 2026-02-04 (AM bins on 2026-02-04)
  - Ellesmere Rd / Morningside Ave — junction 32346645, counted 2025-07-03 (AM bins on 2025-07-03)
  - Dearham Wood / Toynbee Trl — junction 277156095, counted 2025-08-26 (AM bins on 2025-08-26)
  - Kingston Rd / Lawrence Ave E — junction cluster_427825255_427825257_427825263_427825264, counted 2024-10-22 (AM bins on 2024-10-22)
  - Kingston Rd / Falaise Rd — junction cluster_32414945_428554462, counted 2026-01-29 (AM bins on 2026-01-29)
  - Kitchener Rd / Danzig St — junction 277490558, counted 2024-11-12 (AM bins on 2024-11-12)
  - Poplar Rd / Waldock St — junction 277490664, counted 2025-09-30 (AM bins on 2025-09-30)
  - Marlena Dr / Danzig St — junction 277490561, counted 2024-11-12 (AM bins on 2024-11-12)
  - Kingston Rd / Morningside Ave — junction cluster_428559727_428559729_428559734_428559740, counted 2025-07-03 (AM bins on 2025-07-03)
  - Lawrence Ave E / Morningside Ave — junction cluster_427826636_427826638_427826642_427826650, counted 2024-10-22 (AM bins on 2024-10-22)
  - Gloaming Dr / Danzig St — junction 277490895, counted 2024-11-14 (AM bins on 2024-11-14)
  - Kingston Rd / Collinsgrove Rd — junction cluster_5467979726_5467979727, counted 2023-10-14 (AM bins on 2023-10-14)
  - Kingston Rd / Amiens Rd — junction cluster_5467979724_5467979725, counted 2026-01-22 (AM bins on 2026-01-22)
  - Collinsgrove Rd / Ling Rd / Lawrence Ave E — junction 32346406, counted 2024-10-22 (AM bins on 2024-10-22)
  - Morningside Ave / Pixley Cres / Gardentree St — junction 428550609, counted 2025-08-27 (AM bins on 2025-08-27)
  - Dubarry Ave / Darlingside Dr — junction 276550196, counted 2024-11-19 (AM bins on 2024-11-19)
  - Manse Rd / Lawrence Ave E — junction 33539443, counted 2025-05-21 (AM bins on 2025-05-21)
- Spatial gaps > 1.5 km between adjacent supported intersections (west→east). CAVEAT: the chain is ordered by longitude across the WHOLE study area, so adjacent points may sit on parallel arterials — read this as area spread, not along-route spacing (per-arterial spacing is a V2.1b question):
  - 3.1 km between “Brimley Rd / Heather Rd” and “Midland Ave / Millbridge Gt”
  - 2.8 km between “Midland Ave / Millbridge Gt” and “Brimley Rd / Sheppard Ave E”
  - 3.3 km between “Brimley Rd / Sheppard Ave E” and “Midland Ave / Dorcot Ave”
  - 2.8 km between “Midland Ave / Dorcot Ave” and “Brimley Rd / Pitfield Rd”
  - 3.2 km between “Brimley Rd / Pitfield Rd” and “Midland Ave / Brockley Dr”
  - 2.8 km between “Midland Ave / Prudential Dr” and “Brimley Rd / Progress Ave”
  - 3.2 km between “Brimley Rd / Progress Ave” and “Midland Ave / Marcos Blvd / Romulus Dr”
  - 4.7 km between “Midland Ave / Marcos Blvd / Romulus Dr” and “Sheppard Ave E / Brownspring Rd”
  - 4.1 km between “Sheppard Ave E / Brownspring Rd” and “Lawrence Ave E / Brockley Dr”
  - 2.4 km between “Lawrence Ave E / Brockley Dr” and “Brimley Rd / Triton Rd”
  - 3.3 km between “Brimley Rd / Omni Dr / Golden Gate Crt” and “Midland Ave / Stansbury Cres”
  - 3.1 km between “Midland Ave / Stansbury Cres” and “Ellesmere Rd / Brimley Rd”
  - 3.2 km between “Ellesmere Rd / Brimley Rd” and “Midland Ave / Lord Roberts Dr”
  - 3.0 km between “Midland Ave / Lord Roberts Dr” and “Brimley Rd / Applefield Dr / Bernadine St”
  - 2.7 km between “Brimley Rd / Waterfield Dr / Brimorton Dr” and “McCowan Rd / Sheppard Ave E”
  - 3.1 km between “McCowan Rd / Sheppard Ave E” and “Brimley Rd / St Andrews Rd / Applefield Dr”
  - 1.9 km between “Ellesmere Rd / Borough Approach W” and “McCowan Rd / Pitfield Rd / Invergordon Ave”
  - 3.2 km between “McCowan Rd / Pitfield Rd / Invergordon Ave” and “Brimley Rd / Dorcot Ave / Thomson Memorial Park Trl”
  - 2.9 km between “Brimley Rd / Dorcot Ave / Thomson Memorial Park Trl” and “McCowan Rd / Milner Ave / Channel Nine Crt”
  - 2.8 km between “Progress Ave / Corporate Dr” and “Brimley Rd / Lawrence Ave E / Gatineau Hydro Corridor Trl”
  - 2.1 km between “Brimley Rd / Lawrence Ave E / Gatineau Hydro Corridor Trl” and “Borough Dr / Town Centre Crt (South)”
  - 2.8 km between “Borough Dr / Town Centre Crt (North)” and “Brimley Rd / Shediac Rd / Fraserton Gt”
  - 3.4 km between “Brimley Rd / Shediac Rd / Fraserton Gt” and “Corporate Dr / Hwy 401 Collectors E Ramp”
  - 3.2 km between “McCowan Rd / Bushby Dr / Town Centre Crt” and “Brimley Rd / Deerfield Rd”
  - 2.0 km between “Lawrence Ave E / Barrymore Rd” and “Ellesmere Rd / McCowan Rd”
  - 3.2 km between “Ellesmere Rd / McCowan Rd” and “Brimley Rd / Gully Dr / Knob Hill Park Trl”
  - 4.0 km between “Brimley Rd / Gully Dr / Knob Hill Park Trl” and “Consilium Pl / Corporate Dr”
  - 4.2 km between “Consilium Pl / Corporate Dr” and “Brimley Rd / Citadel Dr”
  - 2.8 km between “Brimley Rd / Chillery Ave” and “McCowan Rd / Brimorton Dr”
  - 1.7 km between “McCowan Rd / Brimorton Dr” and “Lee Centre Dr / Corporate Dr / Lee Centre Park Trl”
  - 2.8 km between “Lee Centre Dr / Corporate Dr / Lee Centre Park Trl” and “Lawrence Ave E / Valparaiso Ave”
  - 1.7 km between “Lawrence Ave E / Valparaiso Ave” and “Danforth Rd / Trudelle St”
  - 3.7 km between “Perivale Cres / Dignam Crt” and “Milner Ave / Mid-Dominion Acres / Executive Crt”
  - 1.6 km between “Milner Ave / Mid-Dominion Acres / Executive Crt” and “Amberjack Blvd / Bellamy Rd N / Lynnbrook Dr”
  - 1.8 km between “Amberjack Blvd / Bellamy Rd N / Lynnbrook Dr” and “Lawrence Ave E / Burnview Cres”
  - 3.2 km between “Bellamy Rd N / Northleigh Dr” and “McCowan Rd / Trudelle St”
  - 5.6 km between “Eglinton Ave E / McCowan Rd” and “Markham Rd / Milner Ave”
  - 3.2 km between “Markham Rd / Milner Ave” and “Bellamy Rd N / Painted Post Dr”
  - 2.0 km between “Lawrence Ave E / Bellamy Rd N” and “Eglinton Ave E / Torrance Rd”
  - 2.4 km between “Lawrence Ave E / Greenbrae Crct / Greencedar Crct” and “Markham Rd / Tuxedo Crt”
  - 4.4 km between “Markham Rd / Tuxedo Crt” and “Eglinton Ave E / Bellamy Rd N”
  - 2.3 km between “Farmbrook Rd / Porchester Dr” and “Markham Rd / Rochman Blvd”
  - 1.6 km between “Markham Rd / Greenbrae Crct / Greenholm Crct” and “Porchester Dr / Nelson St”
  - 2.0 km between “Markham Rd / Lawrence Ave E” and “Eglinton Ave E / Mason Rd”
  - 1.9 km between “Markham Rd / Greencedar Crct / Greencrest Crct” and “Mason Rd / Adanac Dr”
  - 2.2 km between “Mason Rd / Adanac Dr” and “Lawrence Ave E / Greenholm Crct / Greencrest Crct”
  - 3.4 km between “Eglinton Ave E / Beachell St” and “Brimorton Dr / Painted Post Dr”
  - 3.7 km between “Brimorton Dr / Painted Post Dr” and “Lochleven Dr / Knowlton Dr / Coltbridge Crt”
  - 2.6 km between “Lochleven Dr / Knowlton Dr / Coltbridge Crt” and “Janray Dr / Fortune Gt”
  - 1.8 km between “Lawrence Ave E / Fortune Gt” and “Markham Rd / Luella St”
  - 4.3 km between “Markham Rd / Markanna Dr” and “Ellesmere Rd / Orton Park Rd / Military Trl / Hydro Corridor”
  - 2.0 km between “Ellesmere Rd / Orton Park Rd / Military Trl / Hydro Corridor” and “Lawrence Ave E / Scarborough Golf Club Rd”
  - 2.0 km between “Lawrence Ave E / Scarborough Golf Club Rd” and “Eglinton Ave E / Cedar Dr”
  - 4.8 km between “Eglinton Ave E / Cedar Dr” and “Highcastle Rd / Oakmeadow Blvd (South)”
  - 4.8 km between “Highcastle Rd / Oakmeadow Blvd (South)” and “Kingston Rd / Eglinton Ave E”
  - 5.1 km between “Kingston Rd / Eglinton Ave E” and “Neilson Rd / Keeler Blvd / Oakmeadow Blvd”
  - 3.0 km between “Neilson Rd / Keeler Blvd / Oakmeadow Blvd” and “Lawrence Ave E / Mossbank Dr”
  - 1.9 km between “Lawrence Ave E / Mossbank Dr” and “Kingston Rd / Scarborough Golf Club Rd”
  - 4.7 km between “Kingston Rd / Scarborough Golf Club Rd” and “Neilson Rd / Military Trl”
  - 2.1 km between “Neilson Rd / Military Trl” and “Orton Park Rd / Thornbeck Dr”
  - 1.9 km between “Orton Park Rd / Thornbeck Dr” and “Neilson Rd / Livonia Pl / Purpledusk Trl”
  - 4.0 km between “Neilson Rd / Livonia Pl / Purpledusk Trl” and “Kingston Rd / Cromwell Rd / Guildwood Pkwy”
  - 1.6 km between “Kingston Rd / Cromwell Rd / Guildwood Pkwy” and “Lawrence Ave E / Orton Park Rd”
  - 2.1 km between “Lawrence Ave E / Orton Park Rd” and “Ellesmere Rd / Neilson Rd”
  - 2.0 km between “Ellesmere Rd / Neilson Rd” and “Lawrence Ave E / Overture Rd”
  - 2.0 km between “Lawrence Ave E / Overture Rd” and “Livingston Rd / Guildwood Pkwy”
  - 2.1 km between “Livingston Rd / Guildwood Pkwy” and “Lawrence Ave E / Galloway Rd”
  - 2.1 km between “Lawrence Ave E / Galloway Rd” and “Ellesmere Rd / Mornelle Crt”
  - 3.7 km between “Ellesmere Rd / Morningside Ave” and “Dearham Wood / Toynbee Trl”
  - 1.7 km between “Dearham Wood / Toynbee Trl” and “Kingston Rd / Lawrence Ave E”
- SVC midblock locations with a weekday-AM-peak volume: **785** (aging=100, recent=254, stale=431).

**V2.1b decision input (the gate question, restated — not answered here):** is this enough counted, recent, AM-peak-covering data to calibrate an AM peak on this corridor — and if the coverage is thinner than hoped, does the calibrated claim narrow to the counted arterials?
