/*
 * Seeded demo project — "Community Perceptions of Environmental Challenges".
 * Mirrors the worked example used throughout TakwimuBridge's own functional
 * description and user guide (five KIIs + one FGD, environmental/governance
 * themes) so the Analysis dashboard has real, non-trivial numbers the first
 * time someone opens the tool. Safe to edit or delete from the Projects page.
 */
(function () {
  "use strict";

  var DEMO_ID = "proj-demo-community-perceptions";

  function sentences(list) { return list.join(" "); }

  var KII01_TEXT = sentences([
    "The factory near the river keeps releasing waste into the water, and nobody stops them.",
    "Every rainy season the same industrial waste turns the river black and it smells terrible.",
    "Fishermen say the fish are dying because of the chemicals the factories dump upstream.",
    "Even the drinking water wells near the factory now taste of chemicals.",
    "The village layout was never planned properly, so houses and the market are too close to the dump site.",
    "Nobody consulted us before the new road was built, and now it floods every rainy season.",
    "During the dry months, women and girls walk more than five kilometers to fetch clean water.",
    "Many young people in this village have finished school but there is no work for them here.",
    "Since the small factories closed, over a hundred casual workers lost their daily income.",
    "Our youth are forced to migrate to Dar es Salaam because there are no jobs in agriculture processing anymore."
  ]);

  var KII02_TEXT = sentences([
    "We have received complaints about industrial discharge into the river near the mill.",
    "The pollution levels reported by residents are concerning and we are reviewing the permits.",
    "Land use in this district was allocated years ago without a proper zoning plan.",
    "Several settlements were approved in flood-prone areas because planning maps were outdated.",
    "Budget for infrastructure planning has been limited, so many projects are delayed.",
    "The district master plan has not been updated in over a decade.",
    "Coordination between departments on land planning remains weak.",
    "A few young graduates have struggled to find formal employment within the district offices."
  ]);

  var KII03_TEXT = sentences([
    "The dye from the textile workshop turns the stream a strange color every week.",
    "Children who swim in the river often come back with skin rashes.",
    "Livestock that drink from the lower river have been getting sick more often.",
    "Smoke from the burning of factory waste covers the village most evenings.",
    "Even our vegetable gardens near the river are affected by the polluted irrigation water.",
    "The market was built without proper drainage, so it floods whenever it rains.",
    "Nobody planned for the population growth, so the school is now overcrowded.",
    "The old settlement plan did not leave room for a proper waste collection point.",
    "The borehole that used to serve our section of the village has been dry for two years.",
    "During the dry season we sometimes go two days without any water from the tap."
  ]);

  var KII04_TEXT = sentences([
    "There was one reported case of chemical runoff from a processing plant last quarter.",
    "Many of the current land disputes trace back to poor planning decisions made a decade ago.",
    "We inherited a settlement pattern that was never properly surveyed.",
    "Road planning in this district did not account for the seasonal rivers, so bridges keep washing away.",
    "The district has struggled to plan new water points because of unclear land ownership.",
    "Three of our wards have gone without reliable water supply for over a year.",
    "The water scheme that was supposed to serve this area was never completed.",
    "Water rationing has become normal here, even in villages near the river.",
    "Farmers cannot irrigate their fields properly because the canal has run dry.",
    "Unemployment among young people leaving secondary school remains one of our biggest challenges.",
    "Many former agricultural workers have not found new jobs since the cooperative closed."
  ]);

  var KII05_TEXT = sentences([
    "Waste from the rice processing factory flows directly into our irrigation channel.",
    "The smell from the factory drainage affects the whole eastern side of the village.",
    "We have noticed more skin problems among children who play near the drainage canal.",
    "Our farmland was allocated without considering where the water sources were.",
    "The cooperative building was constructed far from most farmers because of poor site planning.",
    "This year the irrigation dam has almost no water left for the second planting season.",
    "Women in our group now spend most mornings searching for water instead of farming.",
    "The river that used to feed our farms has become seasonal instead of permanent.",
    "Many young women in our group have no steady income outside the farming season.",
    "When the rice mill reduced its workers, dozens of women in this village lost their jobs.",
    "Our sons and daughters finish school and sit idle because there is no work in this ward.",
    "Even members with farming skills cannot find paid work during the dry months."
  ]);

  var FGD01_TEXT = sentences([
    "Moderator: Let's talk about the challenges you face in this ward, starting with the environment.",
    "P1: The waste from the small mill behind the market pollutes the stream we use for washing.",
    "P2: Even our chickens have been getting sick from the water near the mill.",
    "P3: We were never involved when the mill's drainage plan was approved, and now we live with the consequences.",
    "P1: Water is also becoming harder to find, our shallow wells dry up earlier every year.",
    "P2: Many of us, especially the women, have no reliable income once the farming season ends.",
    "P3: Some of our sons left for the city because there is no work here between harvests.",
    "Moderator: Thank you all, are there any other planning issues you want to mention?",
    "P1: The market itself was built without proper drainage, so during rains it becomes unusable."
  ]);

  function buildDemoProject() {
    var themes = [
      { id: "thm-env", name: "Environmental Challenges", parentId: null, color: "#4B2E83",
        memo: "Broad environmental issues raised across interviews." },
      { id: "thm-pollution", name: "Environmental Pollution", parentId: "thm-env", color: "#8E44AD", memo: "" },
      { id: "thm-water", name: "Water Scarcity", parentId: "thm-env", color: "#2F6FED", memo: "" },
      { id: "thm-deforestation", name: "Deforestation", parentId: "thm-env", color: "#16A085",
        memo: "No coded references yet in this demo — shows how an empty theme looks." },
      { id: "thm-gov", name: "Governance & Economic Challenges", parentId: null, color: "#C0392B",
        memo: "Planning and livelihood-related issues." },
      { id: "thm-planning", name: "Poor Planning", parentId: "thm-gov", color: "#E08E45", memo: "" },
      { id: "thm-unemployment", name: "Unemployment", parentId: "thm-gov", color: "#D35400", memo: "" },
      { id: "thm-enforcement", name: "Weak Enforcement", parentId: "thm-gov", color: "#B3261E", memo: "" }
    ];

    var sources = [
      { id: "src-kii-01", type: "KII", name: "KII-01", memo: "Abbreviated for demo purposes.",
        attributes: { respondentId: "KII-01", sex: "Female", location: "Morogoro", stakeholder: "Community Member", institution: "Village Council" },
        speakers: [], text: KII01_TEXT },
      { id: "src-kii-02", type: "KII", name: "KII-02", memo: "Abbreviated for demo purposes.",
        attributes: { respondentId: "KII-02", sex: "Male", location: "Mvomero", stakeholder: "Government Official", institution: "District Council" },
        speakers: [], text: KII02_TEXT },
      { id: "src-kii-03", type: "KII", name: "KII-03", memo: "Abbreviated for demo purposes.",
        attributes: { respondentId: "KII-03", sex: "Female", location: "Morogoro", stakeholder: "Community Member", institution: "" },
        speakers: [], text: KII03_TEXT },
      { id: "src-kii-04", type: "KII", name: "KII-04", memo: "Abbreviated for demo purposes.",
        attributes: { respondentId: "KII-04", sex: "Male", location: "Kilosa", stakeholder: "Government Official", institution: "District Council" },
        speakers: [], text: KII04_TEXT },
      { id: "src-kii-05", type: "KII", name: "KII-05", memo: "Abbreviated for demo purposes.",
        attributes: { respondentId: "KII-05", sex: "Female", location: "Mvomero", stakeholder: "Community Member", institution: "Farmers Association" },
        speakers: [], text: KII05_TEXT },
      { id: "src-fgd-01", type: "FGD", name: "FGD-01", memo: "Community discussion, Morogoro ward. Speaker-level coding demo.",
        attributes: { location: "Morogoro", stakeholder: "Mixed Community Group", institution: "" },
        speakers: [{ id: "mod", label: "Moderator" }, { id: "p1", label: "P1" }, { id: "p2", label: "P2" }, { id: "p3", label: "P3" }],
        text: FGD01_TEXT }
    ];

    var P = "thm-pollution", W = "thm-water", G = "thm-planning", U = "thm-unemployment", E = "thm-enforcement";

    var codingDefs = [
      // KII-01: Pollution x4 (one multi-coded with Weak Enforcement), Poor Planning x2, Water Scarcity x1, Unemployment x3
      { sourceId: "src-kii-01", quote: "The factory near the river keeps releasing waste into the water, and nobody stops them.", themeIds: [P, E], weight: 9 },
      { sourceId: "src-kii-01", quote: "Every rainy season the same industrial waste turns the river black and it smells terrible.", themeIds: [P], weight: 7 },
      { sourceId: "src-kii-01", quote: "Fishermen say the fish are dying because of the chemicals the factories dump upstream.", themeIds: [P], weight: 8 },
      { sourceId: "src-kii-01", quote: "Even the drinking water wells near the factory now taste of chemicals.", themeIds: [P], weight: 6 },
      { sourceId: "src-kii-01", quote: "The village layout was never planned properly, so houses and the market are too close to the dump site.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-01", quote: "Nobody consulted us before the new road was built, and now it floods every rainy season.", themeIds: [G], weight: 5 },
      { sourceId: "src-kii-01", quote: "During the dry months, women and girls walk more than five kilometers to fetch clean water.", themeIds: [W], weight: 7 },
      { sourceId: "src-kii-01", quote: "Many young people in this village have finished school but there is no work for them here.", themeIds: [U], weight: 6 },
      { sourceId: "src-kii-01", quote: "Since the small factories closed, over a hundred casual workers lost their daily income.", themeIds: [U], weight: 8 },
      { sourceId: "src-kii-01", quote: "Our youth are forced to migrate to Dar es Salaam because there are no jobs in agriculture processing anymore.", themeIds: [U], weight: 7 },

      // KII-02: Pollution x2, Poor Planning x5, Water Scarcity x0, Unemployment x1
      { sourceId: "src-kii-02", quote: "We have received complaints about industrial discharge into the river near the mill.", themeIds: [P], weight: 5 },
      { sourceId: "src-kii-02", quote: "The pollution levels reported by residents are concerning and we are reviewing the permits.", themeIds: [P], weight: 4 },
      { sourceId: "src-kii-02", quote: "Land use in this district was allocated years ago without a proper zoning plan.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-02", quote: "Several settlements were approved in flood-prone areas because planning maps were outdated.", themeIds: [G], weight: 8 },
      { sourceId: "src-kii-02", quote: "Budget for infrastructure planning has been limited, so many projects are delayed.", themeIds: [G], weight: 5 },
      { sourceId: "src-kii-02", quote: "The district master plan has not been updated in over a decade.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-02", quote: "Coordination between departments on land planning remains weak.", themeIds: [G], weight: 7 },
      { sourceId: "src-kii-02", quote: "A few young graduates have struggled to find formal employment within the district offices.", themeIds: [U], weight: 4 },

      // KII-03: Pollution x5, Poor Planning x3, Water Scarcity x2, Unemployment x0
      { sourceId: "src-kii-03", quote: "The dye from the textile workshop turns the stream a strange color every week.", themeIds: [P], weight: 8 },
      { sourceId: "src-kii-03", quote: "Children who swim in the river often come back with skin rashes.", themeIds: [P], weight: 9 },
      { sourceId: "src-kii-03", quote: "Livestock that drink from the lower river have been getting sick more often.", themeIds: [P], weight: 7 },
      { sourceId: "src-kii-03", quote: "Smoke from the burning of factory waste covers the village most evenings.", themeIds: [P], weight: 6 },
      { sourceId: "src-kii-03", quote: "Even our vegetable gardens near the river are affected by the polluted irrigation water.", themeIds: [P], weight: 7 },
      { sourceId: "src-kii-03", quote: "The market was built without proper drainage, so it floods whenever it rains.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-03", quote: "Nobody planned for the population growth, so the school is now overcrowded.", themeIds: [G], weight: 5 },
      { sourceId: "src-kii-03", quote: "The old settlement plan did not leave room for a proper waste collection point.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-03", quote: "The borehole that used to serve our section of the village has been dry for two years.", themeIds: [W], weight: 8 },
      { sourceId: "src-kii-03", quote: "During the dry season we sometimes go two days without any water from the tap.", themeIds: [W], weight: 9 },

      // KII-04: Pollution x1, Poor Planning x4, Water Scarcity x4, Unemployment x2
      { sourceId: "src-kii-04", quote: "There was one reported case of chemical runoff from a processing plant last quarter.", themeIds: [P], weight: 5 },
      { sourceId: "src-kii-04", quote: "Many of the current land disputes trace back to poor planning decisions made a decade ago.", themeIds: [G], weight: 7 },
      { sourceId: "src-kii-04", quote: "We inherited a settlement pattern that was never properly surveyed.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-04", quote: "Road planning in this district did not account for the seasonal rivers, so bridges keep washing away.", themeIds: [G], weight: 8 },
      { sourceId: "src-kii-04", quote: "The district has struggled to plan new water points because of unclear land ownership.", themeIds: [G], weight: 7 },
      { sourceId: "src-kii-04", quote: "Three of our wards have gone without reliable water supply for over a year.", themeIds: [W], weight: 9 },
      { sourceId: "src-kii-04", quote: "The water scheme that was supposed to serve this area was never completed.", themeIds: [W], weight: 8 },
      { sourceId: "src-kii-04", quote: "Water rationing has become normal here, even in villages near the river.", themeIds: [W], weight: 9 },
      { sourceId: "src-kii-04", quote: "Farmers cannot irrigate their fields properly because the canal has run dry.", themeIds: [W], weight: 7 },
      { sourceId: "src-kii-04", quote: "Unemployment among young people leaving secondary school remains one of our biggest challenges.", themeIds: [U], weight: 8 },
      { sourceId: "src-kii-04", quote: "Many former agricultural workers have not found new jobs since the cooperative closed.", themeIds: [U], weight: 6 },

      // KII-05: Pollution x3, Poor Planning x2, Water Scarcity x3, Unemployment x4
      { sourceId: "src-kii-05", quote: "Waste from the rice processing factory flows directly into our irrigation channel.", themeIds: [P], weight: 7 },
      { sourceId: "src-kii-05", quote: "The smell from the factory drainage affects the whole eastern side of the village.", themeIds: [P], weight: 6 },
      { sourceId: "src-kii-05", quote: "We have noticed more skin problems among children who play near the drainage canal.", themeIds: [P], weight: 8 },
      { sourceId: "src-kii-05", quote: "Our farmland was allocated without considering where the water sources were.", themeIds: [G], weight: 6 },
      { sourceId: "src-kii-05", quote: "The cooperative building was constructed far from most farmers because of poor site planning.", themeIds: [G], weight: 5 },
      { sourceId: "src-kii-05", quote: "This year the irrigation dam has almost no water left for the second planting season.", themeIds: [W], weight: 9 },
      { sourceId: "src-kii-05", quote: "Women in our group now spend most mornings searching for water instead of farming.", themeIds: [W], weight: 7 },
      { sourceId: "src-kii-05", quote: "The river that used to feed our farms has become seasonal instead of permanent.", themeIds: [W], weight: 8 },
      { sourceId: "src-kii-05", quote: "Many young women in our group have no steady income outside the farming season.", themeIds: [U], weight: 6 },
      { sourceId: "src-kii-05", quote: "When the rice mill reduced its workers, dozens of women in this village lost their jobs.", themeIds: [U], weight: 8 },
      { sourceId: "src-kii-05", quote: "Our sons and daughters finish school and sit idle because there is no work in this ward.", themeIds: [U], weight: 5 },
      { sourceId: "src-kii-05", quote: "Even members with farming skills cannot find paid work during the dry months.", themeIds: [U], weight: 7 },

      // FGD-01: speaker-level coding demo
      { sourceId: "src-fgd-01", speakerId: "p1", quote: "The waste from the small mill behind the market pollutes the stream we use for washing.", themeIds: [P], weight: 7 },
      { sourceId: "src-fgd-01", speakerId: "p2", quote: "Even our chickens have been getting sick from the water near the mill.", themeIds: [P], weight: 6 },
      { sourceId: "src-fgd-01", speakerId: "p3", quote: "We were never involved when the mill's drainage plan was approved, and now we live with the consequences.", themeIds: [G, E], weight: 8 },
      { sourceId: "src-fgd-01", speakerId: "p1", quote: "Water is also becoming harder to find, our shallow wells dry up earlier every year.", themeIds: [W], weight: 7 },
      { sourceId: "src-fgd-01", speakerId: "p2", quote: "Many of us, especially the women, have no reliable income once the farming season ends.", themeIds: [U], weight: 6 },
      { sourceId: "src-fgd-01", speakerId: "p3", quote: "Some of our sons left for the city because there is no work here between harvests.", themeIds: [U], weight: 7 },
      { sourceId: "src-fgd-01", speakerId: "p1", quote: "The market itself was built without proper drainage, so during rains it becomes unusable.", themeIds: [G], weight: 5 }
    ];

    var sourceMap = {};
    sources.forEach(function (s) { sourceMap[s.id] = s; });

    var codings = codingDefs.map(function (c, i) {
      var src = sourceMap[c.sourceId];
      var start = src.text.indexOf(c.quote);
      if (start < 0) {
        console.warn("TakwimuBridge demo data: quote not found verbatim in source text", c.sourceId, c.quote);
        start = 0;
      }
      return {
        id: "cod-demo-" + i,
        sourceId: c.sourceId,
        speakerId: c.speakerId || null,
        themeIds: c.themeIds,
        start: start,
        end: start + c.quote.length,
        quote: c.quote,
        weight: c.weight != null ? c.weight : null,
        memo: c.memo || "",
        createdAt: Date.now() - (codingDefs.length - i) * 1000
      };
    });

    return {
      id: DEMO_ID,
      title: "Community Perceptions of Environmental Challenges",
      description: "Illustrative demo project bundled with TakwimuBridge, based on the tool's own worked example: five Key Informant Interviews plus one Focus Group Discussion on environmental and governance challenges in Morogoro Region, Tanzania.",
      topic: "Environmental & Governance Challenges",
      researcher: "Demo Researcher",
      org: "Sustainable Solutions Tanzania (SST)",
      date: "2026-01-15",
      weightingEnabled: true,
      memo: "This is bundled seed/demo content — safe to edit or delete. Create a new project from the Projects page for your own research.",
      createdAt: Date.now(),
      sources: sources,
      themes: themes,
      codings: codings
    };
  }

  window.TB = window.TB || {};
  window.TB.DEMO_PROJECT_ID = DEMO_ID;
  window.TB.seedDemoIfNeeded = function () {
    if (localStorage.getItem("tb_demo_seeded")) return;
    var project = buildDemoProject();
    window.TB.saveProject(project);
    if (!window.TB.getActiveProjectId()) window.TB.setActiveProjectId(project.id);
    localStorage.setItem("tb_demo_seeded", "1");
  };
  window.TB.rebuildDemoProject = function () {
    var project = buildDemoProject();
    window.TB.saveProject(project);
    return project;
  };
})();
