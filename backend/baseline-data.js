// ═══════════════════════════════════════════════════════════════════════
// BASELINE DATA — National/state reference data for student comparisons
// ═══════════════════════════════════════════════════════════════════════
// Sources: NCES, CollegeBoard, ACT.org, NACAC
// This file is imported by server.js and seeded into SQLite on first run.

// ─── GPA Distributions (Source: NCES HSLS:09 + ELS longitudinal studies) ───
import { GENERATED_COLLEGE_PROFILES } from "./generated/college-profiles.generated.js";

export const GPA_BASELINES = [
  // National — Unweighted
  { scope:"national", year:2024, percentile:10, gpa_unweighted:2.20, gpa_weighted:2.50, source:"NCES HSLS:09 longitudinal" },
  { scope:"national", year:2024, percentile:25, gpa_unweighted:2.79, gpa_weighted:3.10, source:"NCES HSLS:09 longitudinal" },
  { scope:"national", year:2024, percentile:50, gpa_unweighted:3.15, gpa_weighted:3.50, source:"NCES HSLS:09 longitudinal" },
  { scope:"national", year:2024, percentile:75, gpa_unweighted:3.60, gpa_weighted:4.00, source:"NCES HSLS:09 longitudinal" },
  { scope:"national", year:2024, percentile:90, gpa_unweighted:3.88, gpa_weighted:4.40, source:"NCES HSLS:09 longitudinal" },
  { scope:"national", year:2024, percentile:95, gpa_unweighted:3.95, gpa_weighted:4.65, source:"NCES HSLS:09 longitudinal" },
  // College-bound subset (students who apply to 4-year colleges)
  { scope:"college_bound", year:2024, percentile:10, gpa_unweighted:2.80, gpa_weighted:3.10, source:"NACAC State of Admissions 2024" },
  { scope:"college_bound", year:2024, percentile:25, gpa_unweighted:3.20, gpa_weighted:3.55, source:"NACAC State of Admissions 2024" },
  { scope:"college_bound", year:2024, percentile:50, gpa_unweighted:3.55, gpa_weighted:3.90, source:"NACAC State of Admissions 2024" },
  { scope:"college_bound", year:2024, percentile:75, gpa_unweighted:3.80, gpa_weighted:4.25, source:"NACAC State of Admissions 2024" },
  { scope:"college_bound", year:2024, percentile:90, gpa_unweighted:3.95, gpa_weighted:4.60, source:"NACAC State of Admissions 2024" },
  // T20-admitted subset
  { scope:"t20_admitted", year:2024, percentile:10, gpa_unweighted:3.70, gpa_weighted:4.10, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:25, gpa_unweighted:3.85, gpa_weighted:4.35, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:50, gpa_unweighted:3.92, gpa_weighted:4.55, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:75, gpa_unweighted:3.98, gpa_weighted:4.75, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:90, gpa_unweighted:4.00, gpa_weighted:4.90, source:"Common Data Set aggregates" },
];

// ─── SAT Score Distributions (Source: CollegeBoard 2024 Annual Report) ───
export const SAT_BASELINES = [
  { scope:"national", year:2024, percentile:10, score:830, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:25, score:960, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:50, score:1098, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:75, score:1240, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:90, score:1380, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:95, score:1450, source:"CollegeBoard SAT Suite 2024" },
  { scope:"national", year:2024, percentile:99, score:1550, source:"CollegeBoard SAT Suite 2024" },
  // College-bound
  { scope:"college_bound", year:2024, percentile:25, score:1050, source:"CollegeBoard SAT Suite 2024" },
  { scope:"college_bound", year:2024, percentile:50, score:1190, source:"CollegeBoard SAT Suite 2024" },
  { scope:"college_bound", year:2024, percentile:75, score:1340, source:"CollegeBoard SAT Suite 2024" },
  // T20-admitted
  { scope:"t20_admitted", year:2024, percentile:25, score:1450, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:50, score:1520, source:"Common Data Set aggregates" },
  { scope:"t20_admitted", year:2024, percentile:75, score:1570, source:"Common Data Set aggregates" },
];

// ─── ACT Score Distributions (Source: ACT.org 2024 Profile Report) ───
export const ACT_BASELINES = [
  { scope:"national", year:2024, percentile:10, score:14, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:25, score:17, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:50, score:20, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:75, score:25, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:90, score:30, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:95, score:33, source:"ACT Profile Report 2024" },
  { scope:"national", year:2024, percentile:99, score:35, source:"ACT Profile Report 2024" },
];

// ─── EC Benchmarks (Source: NACAC, NCES HSLS, CIRP Freshman Survey) ───
export const EC_BENCHMARKS = [
  // General participation rates among college-bound students
  { category:"club", participation_pct:68, avg_hours:4, leadership_pct:22, impact_tier:3, target_major:"General", source:"NCES HSLS:09", year:2024 },
  { category:"varsity", participation_pct:42, avg_hours:12, leadership_pct:15, impact_tier:3, target_major:"General", source:"NCES HSLS:09", year:2024 },
  { category:"community_service", participation_pct:58, avg_hours:3, leadership_pct:18, impact_tier:3, target_major:"General", source:"CIRP Freshman Survey", year:2024 },
  { category:"work", participation_pct:35, avg_hours:10, leadership_pct:8, impact_tier:2, target_major:"General", source:"NCES HSLS:09", year:2024 },
  { category:"research", participation_pct:12, avg_hours:6, leadership_pct:5, impact_tier:4, target_major:"STEM", source:"NACAC 2024", year:2024 },
  { category:"arts", participation_pct:28, avg_hours:6, leadership_pct:12, impact_tier:3, target_major:"Arts/Design", source:"NCES HSLS:09", year:2024 },
  // Major-specific impact (what T20 admits typically have)
  { category:"research", participation_pct:45, avg_hours:8, leadership_pct:15, impact_tier:5, target_major:"Computer Science", source:"NACAC/CDS aggregates", year:2024 },
  { category:"research", participation_pct:62, avg_hours:10, leadership_pct:20, impact_tier:5, target_major:"Pre-Med/Biology", source:"NACAC/CDS aggregates", year:2024 },
  { category:"club", participation_pct:72, avg_hours:6, leadership_pct:40, impact_tier:4, target_major:"Business/Economics", source:"NACAC/CDS aggregates", year:2024 },
  { category:"varsity", participation_pct:55, avg_hours:15, leadership_pct:30, impact_tier:4, target_major:"Engineering", source:"NACAC/CDS aggregates", year:2024 },
  { category:"community_service", participation_pct:70, avg_hours:5, leadership_pct:35, impact_tier:4, target_major:"Education", source:"NACAC/CDS aggregates", year:2024 },
  { category:"arts", participation_pct:85, avg_hours:12, leadership_pct:25, impact_tier:5, target_major:"Arts/Design", source:"NACAC/CDS aggregates", year:2024 },
  { category:"club", participation_pct:65, avg_hours:5, leadership_pct:35, impact_tier:4, target_major:"Political Science/Government", source:"NACAC/CDS aggregates", year:2024 },
];

// ─── Competitive Activity Benchmarks (granular, with qualifier levels) ───
// Each entry has: participation rate, per-major impact tiers, and
// ordered qualifier levels with selectivity and admissions-weight.
export const COMPETITIVE_ACTIVITY_BENCHMARKS = [
  {
    activity_id: "math_olympiad",
    activity_name: "Math Olympiad (AMC/AIME/USAMO/IMO)",
    category: "competitive_math",
    participation_rate: 6.2,
    source: "MAA AMC Program Statistics 2024",
    year: 2024,
    target_majors: [
      { major: "Mathematics", impact_tier: 1 },
      { major: "Computer Science", impact_tier: 1 },
      { major: "Physics", impact_tier: 2 },
      { major: "Engineering", impact_tier: 2 },
      { major: "Economics", impact_tier: 3 },
    ],
    qualifier_levels: [
      { level: "AMC 8 participant", selectivity: 0.15, admissions_weight: 0.05, prestige_score: 0.15 },
      { level: "AMC 10/12 participant", selectivity: 0.06, admissions_weight: 0.10, prestige_score: 0.25 },
      { level: "AMC 10/12 DHR", selectivity: 0.01, admissions_weight: 0.30, prestige_score: 0.55 },
      { level: "AIME qualifier", selectivity: 0.025, admissions_weight: 0.50, prestige_score: 0.72 },
      { level: "USAMO qualifier", selectivity: 0.002, admissions_weight: 0.80, prestige_score: 0.92 },
      { level: "IMO team member", selectivity: 0.00004, admissions_weight: 1.0, prestige_score: 1.0 },
    ],
    keywords: ["amc", "amc 8", "amc 10", "amc 12", "aime", "usamo", "imo",
               "math olympiad", "mathcounts", "competition math"],
  },
  {
    activity_id: "science_olympiad",
    activity_name: "Science Olympiad",
    category: "competitive_science",
    participation_rate: 4.8,
    source: "Science Olympiad National Tournament Data 2024",
    year: 2024,
    target_majors: [
      { major: "Biology", impact_tier: 1 },
      { major: "Chemistry", impact_tier: 1 },
      { major: "Physics", impact_tier: 1 },
      { major: "Engineering", impact_tier: 2 },
      { major: "Pre-Med", impact_tier: 2 },
      { major: "Environmental Science", impact_tier: 2 },
    ],
    qualifier_levels: [
      { level: "Invitational participant", selectivity: 0.05, admissions_weight: 0.08, prestige_score: 0.20 },
      { level: "Regional competitor", selectivity: 0.03, admissions_weight: 0.20, prestige_score: 0.35 },
      { level: "State qualifier", selectivity: 0.015, admissions_weight: 0.45, prestige_score: 0.60 },
      { level: "Nationals qualifier", selectivity: 0.003, admissions_weight: 0.75, prestige_score: 0.85 },
    ],
    event_categories: ["life_science", "earth_science", "physical_science", "technology", "inquiry"],
    keywords: ["science olympiad", "scioly", "so invitational", "science olympiad state",
               "science olympiad nationals"],
  },
  {
    activity_id: "deca",
    activity_name: "DECA (Business Competitions)",
    category: "competitive_business",
    participation_rate: 3.5,
    source: "DECA Inc. Annual Impact Report 2024",
    year: 2024,
    target_majors: [
      { major: "Business", impact_tier: 1 },
      { major: "Economics", impact_tier: 1 },
      { major: "Marketing", impact_tier: 1 },
      { major: "Finance", impact_tier: 2 },
      { major: "Entrepreneurship", impact_tier: 2 },
    ],
    qualifier_levels: [
      { level: "Chapter member", selectivity: 0.035, admissions_weight: 0.05, prestige_score: 0.15 },
      { level: "District competitor", selectivity: 0.02, admissions_weight: 0.15, prestige_score: 0.30 },
      { level: "State qualifier", selectivity: 0.008, admissions_weight: 0.40, prestige_score: 0.55 },
      { level: "ICDC (nationals)", selectivity: 0.002, admissions_weight: 0.75, prestige_score: 0.82 },
    ],
    event_categories: ["business_management", "finance", "marketing", "entrepreneurship", "hospitality"],
    keywords: ["deca", "deca district", "deca state", "deca icdc", "deca nationals",
               "deca international"],
  },
  {
    activity_id: "fbla",
    activity_name: "FBLA (Future Business Leaders of America)",
    category: "competitive_business",
    participation_rate: 2.8,
    source: "FBLA-PBL National Reports 2024",
    year: 2024,
    target_majors: [
      { major: "Business", impact_tier: 1 },
      { major: "Finance", impact_tier: 1 },
      { major: "Economics", impact_tier: 2 },
      { major: "Computer Science", impact_tier: 3 },
    ],
    qualifier_levels: [
      { level: "Chapter member", selectivity: 0.028, admissions_weight: 0.05, prestige_score: 0.15 },
      { level: "District competitor", selectivity: 0.015, admissions_weight: 0.15, prestige_score: 0.30 },
      { level: "State qualifier", selectivity: 0.006, admissions_weight: 0.40, prestige_score: 0.55 },
      { level: "NLC (nationals)", selectivity: 0.0015, admissions_weight: 0.75, prestige_score: 0.80 },
    ],
    event_categories: ["business_management", "finance", "computer_applications", "communication"],
    keywords: ["fbla", "fbla district", "fbla state", "fbla nationals", "fbla nlc"],
  },
  {
    activity_id: "debate",
    activity_name: "Competitive Debate (NSDA/TOC)",
    category: "competitive_speech_debate",
    participation_rate: 3.2,
    source: "NSDA Membership & Tournament Statistics 2024",
    year: 2024,
    target_majors: [
      { major: "Political Science", impact_tier: 1 },
      { major: "Pre-Law", impact_tier: 1 },
      { major: "Philosophy", impact_tier: 2 },
      { major: "English", impact_tier: 2 },
      { major: "Communications", impact_tier: 2 },
      { major: "International Relations", impact_tier: 2 },
    ],
    qualifier_levels: [
      { level: "Local tournament competitor", selectivity: 0.032, admissions_weight: 0.08, prestige_score: 0.20 },
      { level: "Circuit tournament competitor", selectivity: 0.015, admissions_weight: 0.25, prestige_score: 0.45 },
      { level: "TOC qualifier (bid earner)", selectivity: 0.004, admissions_weight: 0.55, prestige_score: 0.75 },
      { level: "Nationals qualifier", selectivity: 0.002, admissions_weight: 0.70, prestige_score: 0.82 },
      { level: "NSDA Nationals finalist", selectivity: 0.0003, admissions_weight: 0.90, prestige_score: 0.95 },
    ],
    formats: ["lincoln_douglas", "public_forum", "policy", "congress", "world_schools"],
    keywords: ["debate", "nsda", "toc", "tournament of champions", "lincoln douglas",
               "public forum", "policy debate", "congress debate", "speech and debate"],
  },
  {
    activity_id: "first_robotics",
    activity_name: "FIRST Robotics (FRC/FTC/FLL)",
    category: "competitive_robotics",
    participation_rate: 2.5,
    source: "FIRST Impact Data 2024",
    year: 2024,
    target_majors: [
      { major: "Engineering", impact_tier: 1 },
      { major: "Computer Science", impact_tier: 1 },
      { major: "Mechanical Engineering", impact_tier: 1 },
      { major: "Electrical Engineering", impact_tier: 1 },
      { major: "Physics", impact_tier: 3 },
    ],
    qualifier_levels: [
      { level: "FLL/FTC participant", selectivity: 0.025, admissions_weight: 0.08, prestige_score: 0.22 },
      { level: "FRC regional competitor", selectivity: 0.012, admissions_weight: 0.25, prestige_score: 0.45 },
      { level: "FRC championship qualifier", selectivity: 0.004, admissions_weight: 0.55, prestige_score: 0.72 },
      { level: "Chairman's/Impact Award (or equivalent)", selectivity: 0.001, admissions_weight: 0.85, prestige_score: 0.90 },
    ],
    keywords: ["first robotics", "frc", "ftc", "fll", "first lego league",
               "first tech challenge", "chairman's award", "impact award",
               "robotics regional", "robotics championship"],
  },
];


// ─── Expanded College Profiles (Source: NCES IPEDS + Common Data Sets) ───
const MANUAL_COLLEGE_PROFILES = [
  { unitId:"166683",name:"Massachusetts Institute of Technology",state:"MA",sat25:1510,sat75:1580,act25:34,act75:36,acceptance:3.9,enrollment:11934,tuitionIn:61990,tuitionOut:61990,avgGpaAdmitted:3.96,apCoursesValued:["Calculus BC","Physics C: Mechanics","Physics C: E&M","Chemistry","CS A"],topMajors:["CS","Engineering","Physics","Math","Biology"],ecEmphasis:["Research","FIRST Robotics","Math competitions","Hackathons","Science Olympiad"],yieldRate:82,retentionRate:99,gradRate6yr:95,medianEarnings10yr:124000,dataYear:2024 },
  { unitId:"243744",name:"Stanford University",state:"CA",sat25:1500,sat75:1570,act25:34,act75:36,acceptance:3.6,enrollment:17680,tuitionIn:62484,tuitionOut:62484,avgGpaAdmitted:3.96,apCoursesValued:["Calculus BC","Physics C","Biology","CS A","English Language"],topMajors:["CS","Engineering","Biology","Economics","Psychology"],ecEmphasis:["Entrepreneurship","Research","Community impact","Athletics","Arts"],yieldRate:83,retentionRate:99,gradRate6yr:96,medianEarnings10yr:118000,dataYear:2024 },
  { unitId:"166027",name:"Harvard University",state:"MA",sat25:1480,sat75:1580,act25:34,act75:36,acceptance:3.2,enrollment:30631,tuitionIn:59076,tuitionOut:59076,avgGpaAdmitted:3.97,apCoursesValued:["Calculus BC","Biology","Chemistry","US History","English Literature"],topMajors:["Economics","CS","Government","Biology","Math"],ecEmphasis:["Leadership roles","Community service","Debate/MUN","Research","Varsity athletics"],yieldRate:85,retentionRate:98,gradRate6yr:97,medianEarnings10yr:95000,dataYear:2024 },
  { unitId:"110635",name:"UC Berkeley",state:"CA",sat25:1300,sat75:1520,act25:30,act75:35,acceptance:11.3,enrollment:45307,tuitionIn:14312,tuitionOut:44066,avgGpaAdmitted:3.91,apCoursesValued:["Calculus BC","Physics C","CS A","Chemistry","Biology"],topMajors:["CS","Engineering","Business","Biology","Economics"],ecEmphasis:["Research","Coding clubs","Community service","Cultural orgs","Internships"],yieldRate:45,retentionRate:97,gradRate6yr:93,medianEarnings10yr:86000,dataYear:2024 },
  { unitId:"170976",name:"University of Michigan",state:"MI",sat25:1340,sat75:1530,act25:31,act75:34,acceptance:17.7,enrollment:48090,tuitionIn:16736,tuitionOut:57273,avgGpaAdmitted:3.88,apCoursesValued:["Calculus BC","Chemistry","Biology","English Language","Statistics"],topMajors:["Business","Engineering","CS","Psychology","Economics"],ecEmphasis:["Student government","Greek life","Community service","Research","Club sports"],yieldRate:44,retentionRate:97,gradRate6yr:93,medianEarnings10yr:76000,dataYear:2024 },
  { unitId:"139755",name:"Georgia Tech",state:"GA",sat25:1370,sat75:1530,act25:31,act75:35,acceptance:16.0,enrollment:44008,tuitionIn:12682,tuitionOut:33794,avgGpaAdmitted:3.90,apCoursesValued:["Calculus BC","Physics C","CS A","Chemistry","Statistics"],topMajors:["CS","Engineering","Business","Biology","Math"],ecEmphasis:["FIRST Robotics","Engineering clubs","Hackathons","Research","Math competitions"],yieldRate:42,retentionRate:97,gradRate6yr:92,medianEarnings10yr:95000,dataYear:2024 },
  { unitId:"228778",name:"UT Austin",state:"TX",sat25:1230,sat75:1480,act25:27,act75:33,acceptance:29.0,enrollment:52384,tuitionIn:11448,tuitionOut:41070,avgGpaAdmitted:3.80,apCoursesValued:["Calculus AB","Biology","English Language","US History","Statistics"],topMajors:["Business","Engineering","CS","Biology","Communications"],ecEmphasis:["Community service","Student government","Athletics","Cultural orgs","Part-time work"],yieldRate:47,retentionRate:96,gradRate6yr:88,medianEarnings10yr:72000,dataYear:2024 },
  { unitId:"145637",name:"UIUC",state:"IL",sat25:1280,sat75:1500,act25:28,act75:34,acceptance:43.0,enrollment:56607,tuitionIn:16004,tuitionOut:34316,avgGpaAdmitted:3.82,apCoursesValued:["Calculus BC","CS A","Physics C","Chemistry","Statistics"],topMajors:["Engineering","CS","Business","Biology","Psychology"],ecEmphasis:["Engineering clubs","Research","Greek life","Club sports","Hackathons"],yieldRate:35,retentionRate:93,gradRate6yr:86,medianEarnings10yr:78000,dataYear:2024 },
  { unitId:"234076",name:"UVA",state:"VA",sat25:1370,sat75:1520,act25:32,act75:35,acceptance:16.3,enrollment:26245,tuitionIn:20342,tuitionOut:56950,avgGpaAdmitted:3.92,apCoursesValued:["Calculus BC","Biology","US History","English Language","Chemistry"],topMajors:["Business","Economics","Biology","CS","Government"],ecEmphasis:["Student government","Community service","Honor societies","Club sports","Cultural orgs"],yieldRate:40,retentionRate:97,gradRate6yr:95,medianEarnings10yr:80000,dataYear:2024 },
  { unitId:"211440",name:"Carnegie Mellon",state:"PA",sat25:1480,sat75:1560,act25:33,act75:35,acceptance:11.0,enrollment:16811,tuitionIn:63829,tuitionOut:63829,avgGpaAdmitted:3.93,apCoursesValued:["Calculus BC","CS A","Physics C","Statistics","Art History"],topMajors:["CS","Engineering","Business","Art","Math"],ecEmphasis:["Hackathons","Open source","Research","Art portfolio","Robotics"],yieldRate:38,retentionRate:97,gradRate6yr:93,medianEarnings10yr:105000,dataYear:2024 },
  { unitId:"134130",name:"UF",state:"FL",sat25:1300,sat75:1470,act25:28,act75:33,acceptance:23.0,enrollment:55211,tuitionIn:6380,tuitionOut:28658,avgGpaAdmitted:3.85,apCoursesValued:["Calculus AB","Biology","Chemistry","English Language","Statistics"],topMajors:["Business","Biology","Engineering","Psychology","Health"],ecEmphasis:["Community service","Greek life","Research","Club sports","Student government"],yieldRate:52,retentionRate:96,gradRate6yr:90,medianEarnings10yr:65000,dataYear:2024 },
  { unitId:"236948",name:"UW Seattle",state:"WA",sat25:1260,sat75:1470,act25:28,act75:33,acceptance:48.0,enrollment:61689,tuitionIn:12076,tuitionOut:40740,avgGpaAdmitted:3.78,apCoursesValued:["Calculus AB","Biology","CS A","English Language","Environmental Science"],topMajors:["CS","Engineering","Business","Biology","Psychology"],ecEmphasis:["Community service","Research","Coding clubs","Environmental clubs","Part-time work"],yieldRate:38,retentionRate:94,gradRate6yr:84,medianEarnings10yr:73000,dataYear:2024 },
  { unitId:"193900",name:"NYU",state:"NY",sat25:1370,sat75:1530,act25:31,act75:34,acceptance:12.2,enrollment:61803,tuitionIn:62192,tuitionOut:62192,avgGpaAdmitted:3.88,apCoursesValued:["Calculus AB","English Language","US History","Psychology","Art History"],topMajors:["Business","Film","Economics","CS","Psychology"],ecEmphasis:["Film/media","Arts","Internships","Community service","Cultural orgs"],yieldRate:40,retentionRate:94,gradRate6yr:88,medianEarnings10yr:72000,dataYear:2024 },
  { unitId:"164988",name:"Boston University",state:"MA",sat25:1350,sat75:1510,act25:31,act75:34,acceptance:14.0,enrollment:36714,tuitionIn:65168,tuitionOut:65168,avgGpaAdmitted:3.85,apCoursesValued:["Calculus AB","Biology","English Language","Chemistry","Statistics"],topMajors:["Business","Biology","Engineering","CS","Communications"],ecEmphasis:["Community service","Research","Club sports","Internships","Student media"],yieldRate:27,retentionRate:94,gradRate6yr:89,medianEarnings10yr:70000,dataYear:2024 },
  { unitId:"153658",name:"Purdue",state:"IN",sat25:1180,sat75:1430,act25:25,act75:32,acceptance:49.0,enrollment:51344,tuitionIn:9992,tuitionOut:28794,avgGpaAdmitted:3.75,apCoursesValued:["Calculus AB","Physics 1","CS A","Chemistry","Statistics"],topMajors:["Engineering","CS","Business","Biology","Agriculture"],ecEmphasis:["Engineering clubs","FIRST Robotics","4-H/Agriculture","Research","Greek life"],yieldRate:32,retentionRate:93,gradRate6yr:83,medianEarnings10yr:73000,dataYear:2024 },
  { unitId:"204796",name:"Ohio State",state:"OH",sat25:1210,sat75:1420,act25:26,act75:32,acceptance:53.0,enrollment:61369,tuitionIn:11936,tuitionOut:36722,avgGpaAdmitted:3.72,apCoursesValued:["Calculus AB","Biology","English Language","US History","Psychology"],topMajors:["Business","Engineering","Biology","Psychology","CS"],ecEmphasis:["Greek life","Club sports","Community service","Student government","Part-time work"],yieldRate:35,retentionRate:94,gradRate6yr:86,medianEarnings10yr:65000,dataYear:2024 },
  { unitId:"227757",name:"Rice University",state:"TX",sat25:1490,sat75:1570,act25:34,act75:36,acceptance:7.7,enrollment:8973,tuitionIn:58128,tuitionOut:58128,avgGpaAdmitted:3.95,apCoursesValued:["Calculus BC","Physics C","CS A","Chemistry","Biology"],topMajors:["Engineering","CS","Biology","Economics","Architecture"],ecEmphasis:["Research","Community service","Arts","Engineering clubs","Debate"],yieldRate:43,retentionRate:97,gradRate6yr:94,medianEarnings10yr:82000,dataYear:2024 },
  { unitId:"139658",name:"Emory University",state:"GA",sat25:1420,sat75:1530,act25:32,act75:35,acceptance:11.4,enrollment:15452,tuitionIn:60774,tuitionOut:60774,avgGpaAdmitted:3.90,apCoursesValued:["Biology","Chemistry","Calculus AB","English Language","Psychology"],topMajors:["Business","Biology","Economics","Psychology","Nursing"],ecEmphasis:["Hospital volunteering","Research","Community service","Club leadership","Honor societies"],yieldRate:32,retentionRate:95,gradRate6yr:92,medianEarnings10yr:75000,dataYear:2024 },
  { unitId:"123961",name:"USC",state:"CA",sat25:1400,sat75:1540,act25:32,act75:35,acceptance:9.2,enrollment:49318,tuitionIn:66640,tuitionOut:66640,avgGpaAdmitted:3.89,apCoursesValued:["Calculus AB","English Language","Biology","US History","CS A"],topMajors:["Business","Film","CS","Engineering","Communications"],ecEmphasis:["Film/media production","Greek life","Community service","Internships","Entrepreneurship"],yieldRate:39,retentionRate:96,gradRate6yr:92,medianEarnings10yr:80000,dataYear:2024 },
  { unitId:"214777",name:"Penn State",state:"PA",sat25:1160,sat75:1370,act25:25,act75:31,acceptance:54.0,enrollment:88502,tuitionIn:19286,tuitionOut:38824,avgGpaAdmitted:3.62,apCoursesValued:["Calculus AB","Biology","English Language","US History","Psychology"],topMajors:["Engineering","Business","Biology","CS","Education"],ecEmphasis:["Greek life","Club sports","Community service","Student government","Part-time work"],yieldRate:30,retentionRate:92,gradRate6yr:86,medianEarnings10yr:68000,dataYear:2024 },
];

// ─── AP Rigor data (also in frontend — canonical source) ───
function mergeCollegeProfiles(generatedProfiles, manualOverrides) {
  const mergedProfiles = new Map();

  for (const profile of generatedProfiles) mergedProfiles.set(profile.unitId, profile);
  for (const profile of manualOverrides) mergedProfiles.set(profile.unitId, profile);

  return [...mergedProfiles.values()];
}

export const COLLEGE_PROFILES = mergeCollegeProfiles(GENERATED_COLLEGE_PROFILES, MANUAL_COLLEGE_PROFILES);

export const AP_RIGOR = {
  "Physics C: E&M":       {tier:1,label:"Extremely Hard",pct5:30.3,pct3plus:65.1,meanScore:3.3},
  "Physics C: Mechanics":  {tier:1,label:"Extremely Hard",pct5:28.1,pct3plus:68.2,meanScore:3.4},
  "Calculus BC":           {tier:1,label:"Extremely Hard",pct5:41.1,pct3plus:78.4,meanScore:3.8},
  "Chemistry":             {tier:2,label:"Very Hard",pct5:13.9,pct3plus:53.3,meanScore:2.8},
  "Physics 1":             {tier:2,label:"Very Hard",pct5:8.8,pct3plus:43.2,meanScore:2.5},
  "Physics 2":             {tier:2,label:"Very Hard",pct5:14.2,pct3plus:62.4,meanScore:3.0},
  "US History":            {tier:2,label:"Very Hard",pct5:12.1,pct3plus:48.4,meanScore:2.7},
  "European History":      {tier:2,label:"Very Hard",pct5:12.4,pct3plus:51.5,meanScore:2.8},
  "English Literature":    {tier:2,label:"Very Hard",pct5:7.2,pct3plus:43.6,meanScore:2.6},
  "Biology":               {tier:3,label:"Hard",pct5:14.0,pct3plus:64.4,meanScore:3.0},
  "Calculus AB":           {tier:3,label:"Hard",pct5:22.4,pct3plus:58.4,meanScore:3.1},
  "Statistics":            {tier:3,label:"Hard",pct5:16.1,pct3plus:58.3,meanScore:3.0},
  "English Language":      {tier:3,label:"Hard",pct5:10.4,pct3plus:56.1,meanScore:2.8},
  "World History":         {tier:3,label:"Hard",pct5:14.6,pct3plus:53.2,meanScore:2.8},
  "Computer Science A":    {tier:3,label:"Hard",pct5:25.6,pct3plus:66.4,meanScore:3.3},
  "Macroeconomics":        {tier:4,label:"Moderate",pct5:19.1,pct3plus:55.0,meanScore:2.9},
  "Microeconomics":        {tier:4,label:"Moderate",pct5:22.1,pct3plus:63.5,meanScore:3.1},
  "US Government":         {tier:4,label:"Moderate",pct5:13.5,pct3plus:48.2,meanScore:2.7},
  "Psychology":            {tier:4,label:"Moderate",pct5:22.4,pct3plus:59.6,meanScore:3.1},
  "Environmental Science": {tier:4,label:"Moderate",pct5:9.4,pct3plus:49.2,meanScore:2.7},
  "Human Geography":       {tier:5,label:"Introductory",pct5:15.8,pct3plus:53.0,meanScore:2.9},
  "Computer Science Principles":{tier:5,label:"Introductory",pct5:23.0,pct3plus:67.1,meanScore:3.2},
};
