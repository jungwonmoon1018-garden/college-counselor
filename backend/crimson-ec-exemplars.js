// ═══════════════════════════════════════════════════════════════════════
// CRIMSON EC EXEMPLARS — reference set of strong extracurriculars
// ═══════════════════════════════════════════════════════════════════════
// A curated reference list of extracurricular activities seen on competitive
// (T20/T40) applications, grouped by domain. Sourced from publicly shared
// Crimson Education example lists. Used ONLY as CALIBRATION / INSPIRATION for
// the EC idea generator — never copied verbatim into a student's profile and
// never presented as the student's own. The generator injects a RANDOM GROUP
// OF TEN each call (see randomExemplarGroup) so suggestions stay varied and
// grounded in real successful patterns rather than a fixed template.
//
// Each entry: { category, name, description }. Duplicate display names across
// domains (e.g. "Community Theater", "Choir") are intentional — they carry
// distinct descriptions and reflect how the same label shows up in different
// application contexts.
// ═══════════════════════════════════════════════════════════════════════

export const EC_EXEMPLARS = Object.freeze([
  // ── Academic ──
  { category: "Academic", name: "Physics Club", description: "Led experiments and discussions on physics topics, helping students understand complex concepts in an engaging way." },
  { category: "Academic", name: "History Research Project", description: "Conducted in-depth research on the impacts of World War II, presented findings to classmates." },
  { category: "Academic", name: "Science Fair Project", description: "Designed and presented an experiment to test the effectiveness of various water filtration methods." },
  { category: "Academic", name: "Economics Club", description: "Participated in discussions and competitions focused on macroeconomic policies and current events." },
  { category: "Academic", name: "Mathematics Club", description: "Led a team of students in organizing weekly problem-solving sessions and preparing for math competitions." },
  { category: "Academic", name: "Chemistry Olympiad", description: "Participated in national-level competitions, reaching the finals through dedicated study and preparation." },
  { category: "Academic", name: "STEM Outreach", description: "Organized outreach programs in local schools to promote interest in STEM subjects, inspiring younger students." },
  { category: "Academic", name: "Data Analysis Project", description: "Analyzed publicly available data sets to identify trends in environmental changes, mentored by a local college professor." },
  { category: "Academic", name: "National Honor Society", description: "Member actively involved in peer tutoring and community service projects." },
  { category: "Academic", name: "Fun Maths Problem Solving Society", description: "Founded and led a group of 40+ members, organizing weekly problem-solving sessions and inviting guest speakers." },
  { category: "Academic", name: "Maths Competitions", description: "Competed in various competitions, including the British Maths Olympiad, qualifying in multiple years." },
  { category: "Academic", name: "National Ocean Sciences Bowl", description: "Served as Team B Captain, organizing biweekly practices and preparing the team for competitions." },
  { category: "Academic", name: "College Prep Courses", description: "Completed college-level courses in Behavioral Neuroscience and Social Psychology, wrote an analysis on “Narcissism and Social Media.”" },
  { category: "Academic", name: "Neuroscience Society", description: "Founded and led the society, organizing weekly workshops, recruiting members, and shadowing a clinical neurologist." },
  { category: "Academic", name: "Physics Study Guide", description: "Authored a 50-page study guide on physics concepts, reaching over 3000 downloads." },
  { category: "Academic", name: "Astronomy Club", description: "Organized stargazing events and lectures to foster interest in astronomy." },

  // ── Art ──
  { category: "Art", name: "Calligraphy Club", description: "Practiced calligraphy techniques, creating personalized greeting cards for community events." },
  { category: "Art", name: "Pottery Workshop", description: "Created pottery pieces for community events, showcasing artistic skills and craftsmanship." },
  { category: "Art", name: "Graphic Design Club", description: "Designed posters and digital artwork for school events, contributing to the visual branding of campus activities." },
  { category: "Art", name: "Photography Project", description: "Completed a series of wildlife photos for a community exhibit, highlighting local biodiversity." },
  { category: "Art", name: "Piano (community recitals)", description: "Took lessons for thirteen years, performing both contemporary and classical pieces at community recitals." },
  { category: "Art", name: "Environmental Paintings", description: "Created a series of paintings focused on environmental conservation, exhibited at a local gallery to raise awareness." },
  { category: "Art", name: "Community Theater (acting & backstage)", description: "Participated in multiple theater productions over four years, taking on various acting and backstage roles." },
  { category: "Art", name: "Animated Film", description: "Produced a short animated film using digital software, showcased at a local film festival." },
  { category: "Art", name: "Art Club", description: "Founded and led a club to teach drawing techniques to students at the community center." },
  { category: "Art", name: "Mural Painting Project", description: "Created a mural in the school cafeteria to promote environmental awareness." },

  // ── Community Service ──
  { category: "Community Service", name: "Senior Center Volunteer", description: "Organized recreational activities and events for elderly residents at a local senior center." },
  { category: "Community Service", name: "Community Sports Coach", description: "Coached a youth soccer team on weekends, helping young players develop skills and teamwork." },
  { category: "Community Service", name: "Food Bank Volunteer", description: "Organized donations and distributed food to families in need, supporting community food security." },
  { category: "Community Service", name: "Park Restoration Volunteer", description: "Assisted in cleaning and restoring local parks, including planting native trees to improve green spaces." },
  { category: "Community Service", name: "Animal Shelter Volunteer", description: "Helped care for animals and organized adoption events to support local animal shelters." },
  { category: "Community Service", name: "Community Clean-Up", description: "Organized a community clean-up event that attracted over 100 participants, improving the local environment." },
  { category: "Community Service", name: "Habitat for Humanity", description: "Worked as a member to help build homes for underprivileged families in the community." },
  { category: "Community Service", name: "Charity Work", description: "Collaborated with a local charity to distribute food packages to families in need during the holiday season." },
  { category: "Community Service", name: "Mentorship Program", description: "Established a mentorship program for underprivileged middle school students, providing academic and emotional support." },
  { category: "Community Service", name: "Kalliope Organization Committee", description: "Vice President, initiated and organized the school's first charity green fashion show, raising funds for the bursary fund." },
  { category: "Community Service", name: "Youth-run Charity", description: "Founded and managed a charity providing literature to rural and developing areas, expanding educational access." },
  { category: "Community Service", name: "Violinist (charity ensemble)", description: "Played in a string ensemble to raise money for the NSQ Kids in Need program and the Australian Chamber Orchestra Music Education Program for disadvantaged children." },
  { category: "Community Service", name: "International Student Association", description: "Vice President of Community Service, hosted orientation events and organized fundraisers for international social issues." },
  { category: "Community Service", name: "Service Trip", description: "Raised over $10,000 through fundraising, assembled school supply packages, and taught classes at schools in East Timor." },
  { category: "Community Service", name: "NGO Project", description: "Vice Chair, supervised 20 students, collaborated with an NGO to develop a machine that converts plastics into bricks to address pollution." },
  { category: "Community Service", name: "Book Drive Organizer", description: "Collected and distributed books to local schools and libraries in need." },

  // ── Government & Leadership ──
  { category: "Government & Leadership", name: "Mock Trial", description: "Participated in a mock trial competition, gaining insight into the legal process and courtroom procedures." },
  { category: "Government & Leadership", name: "School Event Coordinator", description: "Planned and coordinated school events such as talent shows and fundraisers to enhance student life." },
  { category: "Government & Leadership", name: "Debate Club", description: "Competed in local and regional debate tournaments, winning multiple awards for effective argumentation." },
  { category: "Government & Leadership", name: "Youth City Council Member", description: "Represented youth interests in local government meetings, contributing to community decision-making." },
  { category: "Government & Leadership", name: "Student Council", description: "President leading school-wide initiatives to improve student life, including new programs and events." },
  { category: "Government & Leadership", name: "Youth Advisory Board", description: "Worked with local government to create a board that addresses community issues from a youth perspective." },
  { category: "Government & Leadership", name: "Voter Registration Drive", description: "Organized a voter registration drive at school to increase youth involvement in local elections." },
  { category: "Government & Leadership", name: "Leadership Group", description: "Co-founded a group focused on helping new students transition into high school through mentorship and support." },
  { category: "Government & Leadership", name: "Model United Nations", description: "Represented different countries in international policy discussions, developing negotiation and diplomacy skills." },
  { category: "Government & Leadership", name: "Congresswoman Internship", description: "Interned in Washington, D.C., wrote letters addressing constituent concerns, and attended hearings and briefings." },
  { category: "Government & Leadership", name: "Bilateral Safety Corridor Coalition Internship", description: "Spread awareness about human trafficking by delivering seminars at community centers." },
  { category: "Government & Leadership", name: "Ammar Campa-Najjar Campaign", description: "Intern and Office Manager, managed daily tasks, trained volunteers, and crafted promotional materials in both English and Spanish." },
  { category: "Government & Leadership", name: "Entrepreneurship Summer Program", description: "Prototyped a smartband for individuals with panic disorder, conducted market research, and pitched to investors." },
  { category: "Government & Leadership", name: "News Service Internship", description: "Conducted research on Neural Networks for named entity recognition as part of a summer internship." },
  { category: "Government & Leadership", name: "Law Firm Internship", description: "Conducted economic research and prepared memos in the competition department of a law firm." },

  // ── Media ──
  { category: "Media", name: "Yearbook Committee", description: "Helped design and edit the school's yearbook, capturing key moments from the school year." },
  { category: "Media", name: "School Blog Contributor", description: "Wrote articles for the school's blog, covering various student events and activities." },
  { category: "Media", name: "School Newspaper", description: "Editor-in-chief overseeing content creation, writing articles, and managing a team of student journalists." },
  { category: "Media", name: "Podcast", description: "Produced a podcast discussing political and social issues relevant to teenagers, engaging peers in meaningful conversations." },
  { category: "Media", name: "Magazine Articles", description: "Wrote articles for a local magazine on environmental and social justice topics, raising awareness in the community." },
  { category: "Media", name: "News Anchor", description: "Worked as a news anchor for the school television network, reporting on school events and announcements." },
  { category: "Media", name: "Social Media Management", description: "Managed social media for a school club, increasing engagement by 40% through creative content." },

  // ── Music & Performance ──
  { category: "Music & Performance", name: "School Orchestra", description: "Played violin in the orchestra, performing at school concerts and community events throughout the year." },
  { category: "Music & Performance", name: "Spoken Word Poetry", description: "Wrote and performed original poetry at school talent shows and local community events." },
  { category: "Music & Performance", name: "Jazz Band", description: "Played trumpet in the school jazz band, performing at various school and community events." },
  { category: "Music & Performance", name: "Garage Band", description: "Founded a band with friends, performing at local events and festivals to raise funds for charity." },
  { category: "Music & Performance", name: "Choir (community)", description: "Participated in school and community choir performances, contributing as a vocalist in multiple concerts." },
  { category: "Music & Performance", name: "Dance Showcase", description: "Choreographed and performed dance routines for the school's annual dance showcase." },
  { category: "Music & Performance", name: "Community Theater (lead roles)", description: "Took on lead roles in multiple community theater productions, gaining experience in acting and stage presence." },
  { category: "Music & Performance", name: "School Music Council", description: "Co-President, organized and promoted musical events across campus, collaborating with the music faculty." },
  { category: "Music & Performance", name: "Acapella Group", description: "Co-President, led a group of 17 performers, arranged music pieces, and organized performance opportunities." },
  { category: "Music & Performance", name: "Choir (Alto)", description: "Alto singer, participated in six performances annually, including holiday and spring concerts." },
  { category: "Music & Performance", name: "Violin (first violins)", description: "Played in the first violins section of various orchestras, including school and regional groups." },
  { category: "Music & Performance", name: "Piano (diplomas & competitions)", description: "Classically trained pianist, earned diplomas, and placed in regional and state competitions." },
  { category: "Music & Performance", name: "Cello", description: "Selected as lead cellist for the Youth Orchestra Philharmonic, performed in semi-professional concerts." },

  // ── Sports & Recreation ──
  { category: "Sports & Recreation", name: "Ultimate Frisbee Club", description: "Practiced regularly and competed in local ultimate frisbee tournaments." },
  { category: "Sports & Recreation", name: "Archery Team", description: "Trained weekly and competed in regional archery competitions, developing precision and focus." },
  { category: "Sports & Recreation", name: "Badminton Club", description: "Competed in local tournaments, consistently improving skills through practice." },
  { category: "Sports & Recreation", name: "Rock Climbing Team", description: "Practiced climbing weekly and competed in regional climbing competitions." },
  { category: "Sports & Recreation", name: "Soccer", description: "Captain of the varsity team, leading the team to the regional championships and mentoring younger players." },
  { category: "Sports & Recreation", name: "Tennis", description: "Competed in regional tennis tournaments, achieving a top-ten ranking in singles matches." },
  { category: "Sports & Recreation", name: "Hiking Club", description: "Organized and led weekend hiking trips to nearby trails, promoting outdoor activities among peers." },
  { category: "Sports & Recreation", name: "Martial Arts", description: "Practiced Taekwondo for six years, achieved a black belt, and competed in state-level competitions." },
  { category: "Sports & Recreation", name: "Swimming", description: "Competed in state-level swimming competitions, winning multiple medals in freestyle and butterfly events." },
  { category: "Sports & Recreation", name: "Cross Country", description: "Captain of the cross country team, led training sessions and motivated teammates during competitions." },
  { category: "Sports & Recreation", name: "Basketball", description: "Played as a Power Forward in the first and second squads, competed in the GPS/CAS competition." },
  { category: "Sports & Recreation", name: "Lacrosse", description: "Played as a defenseman, attended daily practices, started in games, and was chosen as captain for multiple matches." },
  { category: "Sports & Recreation", name: "Softball", description: "Team Captain and Starting Pitcher, led practices, and played a key role in regional competitions." },
  { category: "Sports & Recreation", name: "JV Girls Basketball", description: "Team Manager, organized game schedules, managed scorebooks, and assisted coaches during practices." },
  { category: "Sports & Recreation", name: "Netball", description: "Played for the school's netball team, reaching the finals in multiple seasons and contributing as an offensive player." },
  { category: "Sports & Recreation", name: "Kayaking Club", description: "Participated in weekly kayaking trips and led safety workshops for new members." },

  // ── Social Activism ──
  { category: "Social Activism", name: "LGBTQ+ Advocacy Group", description: "Organized events to promote acceptance and equality within the school community." },
  { category: "Social Activism", name: "Anti-Bullying Campaign", description: "Created posters and led workshops to raise awareness about the effects of bullying." },
  { category: "Social Activism", name: "Climate Change Campaign", description: "Organized a campaign to raise awareness of climate change, involving local schools and community members." },
  { category: "Social Activism", name: "Amnesty International", description: "Participated in activities advocating for human rights, including letter-writing campaigns and protests." },
  { category: "Social Activism", name: "Recycling Program", description: "Created a school-wide recycling program to promote environmental sustainability." },
  { category: "Social Activism", name: "Social Justice Protests", description: "Participated in protests advocating for social justice and equality in the community." },
  { category: "Social Activism", name: "Girls Who Code", description: "Founded a local chapter to encourage young women to explore computer science and technology." },
  { category: "Social Activism", name: "Oaktree", description: "Community Leader, raised funds and developed educational curricula for use in developing countries." },
  { category: "Social Activism", name: "Cancer Action Network", description: "Secretary and Spokesperson, advocated for legislation to improve palliative care access for low-income families." },
  { category: "Social Activism", name: "Tikkun Olam", description: "Co-President, organized Holocaust awareness events and cultural activities, including field trips." },
  { category: "Social Activism", name: "Child Rights Group", description: "Founded a group working with NGOs in India to address issues like child abuse and food insecurity." },
  { category: "Social Activism", name: "Special Needs Charity", description: "Founder and Executive Director, set up chapters in seven countries, led inclusion campaigns, and published articles." },
  { category: "Social Activism", name: "Climate Activist Group", description: "Regional Director, organized global events to raise awareness about climate change." },
  { category: "Social Activism", name: "Fair Trade Club", description: "Advocated for fair trade practices by organizing awareness campaigns at school." },

  // ── Technology ──
  { category: "Technology", name: "Game Development Club", description: "Worked with a team to create a video game using Unity, showcased at a school event." },
  { category: "Technology", name: "3D Printing Project", description: "Designed and printed 3D models for use in science classes, integrating technology into learning." },
  { category: "Technology", name: "Volunteer Website", description: "Built a website to connect local community members with volunteer opportunities." },
  { category: "Technology", name: "Hackathon", description: "Participated in a 24-hour hackathon, developing an app to help students track and manage their homework." },
  { category: "Technology", name: "Robotics Club", description: "Lead developer, competed in national robotics competitions, building and programming robots." },
  { category: "Technology", name: "Coding Platform", description: "Created an online platform to teach basic coding to middle school students." },
  { category: "Technology", name: "Machine Learning Project", description: "Developed a machine learning model to analyze social media sentiment as an independent research project." },
  { category: "Technology", name: "Drone Building Workshop", description: "Led a workshop teaching students how to build and pilot drones, focusing on engineering and aerodynamics." },

  // ── Special Interest ──
  { category: "Special Interest", name: "Bird Watching Club", description: "Organized bird-watching trips and documented local bird species, sharing findings with the community." },
  { category: "Special Interest", name: "Gardening Club", description: "Grew vegetables and flowers in the school garden, donating produce to local food banks." },
  { category: "Special Interest", name: "Dungeons and Dragons Club", description: "Organized weekly campaigns, creating an inclusive space for students interested in role-playing games." },
  { category: "Special Interest", name: "Civil War Reenactments", description: "Participated in reenactments, researching historical figures and portraying them at events." },
  { category: "Special Interest", name: "Chess Team", description: "Competed in local and state-level tournaments, developing strategic thinking and problem-solving skills." },
  { category: "Special Interest", name: "Book Club", description: "Founded a club focused on discussing classic literature and modern novels, fostering a love for reading." },
  { category: "Special Interest", name: "Renaissance Faires", description: "Participated in Renaissance Faires, sewing costumes, and acting as a historical character." },

  // ── Drama & Theater ──
  { category: "Drama & Theater", name: "Improv Club", description: "Participated in weekly improv sessions, developing quick-thinking and performance skills." },
  { category: "Drama & Theater", name: "Costume Design", description: "Designed and created costumes for the school play, contributing to the visual aspect of the production." },
  { category: "Drama & Theater", name: "Royal National Theatre of London", description: "Selected for an international dramatist network, attended workshops, and performed in productions." },
  { category: "Drama & Theater", name: "House Drama Captain", description: "Wrote, directed, and organized a school play, managing all aspects of the production." },
  { category: "Drama & Theater", name: "Musical Theatre Group", description: "Trained in dance and acting, restaged musicals in Off-Broadway theaters, performing as a member of the group." },
  { category: "Drama & Theater", name: "Drama Productions", description: "Played lead roles in various productions, including street plays and dance performances." },

  // ── Entrepreneurship ──
  { category: "Entrepreneurship", name: "School Store Manager", description: "Managed inventory and sales for the school store, gaining experience in retail and customer service." },
  { category: "Entrepreneurship", name: "Social Enterprise Founder", description: "Created a business selling handmade crafts to raise funds for a local charity." },
  { category: "Entrepreneurship", name: "Startup Founder", description: "Founded a small business providing eco-friendly products, managing a team of five employees." },
  { category: "Entrepreneurship", name: "E-Commerce Platform", description: "Developed an online store to sell handmade crafts, learning about web development and digital marketing." },
  { category: "Entrepreneurship", name: "Business Plan Competition", description: "Participated in a business plan competition, developed a plan for a social enterprise, and won second place." },

  // ── Environmental & Sustainability Initiatives ──
  { category: "Environmental & Sustainability", name: "Recycling Awareness Campaign", description: "Led a campaign to increase recycling within the school, including organizing educational workshops." },
  { category: "Environmental & Sustainability", name: "Tree Planting Initiative", description: "Organized a tree-planting day, engaging students and community members to promote environmental awareness." },
  { category: "Environmental & Sustainability", name: "School Garden Project", description: "Created a community garden on school grounds to promote sustainability and teach gardening skills." },
  { category: "Environmental & Sustainability", name: "Beach Clean-Up Leader", description: "Organized monthly beach clean-ups, involving community volunteers to help reduce pollution." },
  { category: "Environmental & Sustainability", name: "Composting Initiative", description: "Started a composting program at school to reduce food waste and promote sustainable practices." },
  { category: "Environmental & Sustainability", name: "Water Conservation Campaign", description: "Led a campaign to promote water conservation at school, including installing water-saving devices." },

  // ── Health & Wellness ──
  { category: "Health & Wellness", name: "Meditation Club", description: "Founded a meditation club to teach stress-relief techniques to students." },
  { category: "Health & Wellness", name: "Nutrition Workshop Organizer", description: "Organized workshops on healthy eating habits and nutrition for students." },
  { category: "Health & Wellness", name: "Yoga Club", description: "Founded a yoga club to promote physical fitness and mental well-being among students." },
  { category: "Health & Wellness", name: "Mental Health Advocate", description: "Led workshops to raise awareness about mental health issues and provided resources for students." },
  { category: "Health & Wellness", name: "First Aid Volunteer", description: "Volunteered at local events, providing first aid support as part of a community health organization." },

  // ── Cultural & Language ──
  { category: "Cultural & Language", name: "Spanish Poetry Club", description: "Organized weekly meetings to read, write, and discuss Spanish-language poetry." },
  { category: "Cultural & Language", name: "Japanese Cultural Club", description: "Hosted events celebrating Japanese culture, including traditional tea ceremonies and festivals." },
  { category: "Cultural & Language", name: "Language Exchange Club", description: "Organized weekly meet-ups for language practice between English and Spanish-speaking students." },
  { category: "Cultural & Language", name: "Cultural Festival Coordinator", description: "Planned and coordinated a school-wide cultural festival to celebrate diversity and different heritages." },
  { category: "Cultural & Language", name: "Heritage Dance Group", description: "Participated in a traditional dance group, performing at cultural festivals and school events." },
  { category: "Cultural & Language", name: "Korean Language Club", description: "Organized cultural exchange events and taught basic Korean language to interested students." },

  // ── STEM Competitions ──
  { category: "STEM Competitions", name: "Robotics Competition", description: "Built and programmed a robot to complete specific challenges, competing in a regional competition." },
  { category: "STEM Competitions", name: "Chemistry Challenge", description: "Competed in a state-level chemistry competition, solving complex chemical problems." },
  { category: "STEM Competitions", name: "Science Olympiad", description: "Competed in regional Science Olympiad competitions, winning multiple medals in various science categories." },
  { category: "STEM Competitions", name: "Engineering Design Challenge", description: "Participated in a local engineering design challenge, created a working prototype of a bridge." },
  { category: "STEM Competitions", name: "App Development Competition", description: "Developed a mental health awareness app and presented it at a technology competition." },
]);

// Fisher–Yates shuffle (non-mutating). Uses Math.random — fine for backend
// runtime; this module is never loaded inside a Workflow script.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffle the full exemplar set and chunk it into random groups of ten — the
// "mix them up by random units of ten" organizing principle. Reshuffles each
// call so callers get fresh groupings.
export function shuffledGroupsOfTen() {
  const shuffled = shuffle(EC_EXEMPLARS);
  const groups = [];
  for (let i = 0; i < shuffled.length; i += 10) groups.push(shuffled.slice(i, i + 10));
  return groups;
}

// Return one random group of `count` exemplars (default 10). When `categories`
// is provided, the picks are biased toward those domains (with random others
// filling any shortfall), so a CS-leaning student sees more tech/STEM examples
// while still getting cross-domain inspiration.
export function randomExemplarGroup(count = 10, { categories = [] } = {}) {
  const wanted = new Set((categories || []).map(String));
  const pool = shuffle(EC_EXEMPLARS);
  const preferred = wanted.size ? pool.filter(e => wanted.has(e.category)) : [];
  const rest = wanted.size ? pool.filter(e => !wanted.has(e.category)) : pool;
  return [...preferred, ...rest].slice(0, Math.max(1, count));
}

// Format a group of exemplars into a compact prompt block. The framing makes
// it explicit these are reference patterns for calibration only.
export function exemplarsPromptBlock(group) {
  if (!Array.isArray(group) || !group.length) return "";
  const lines = group.map(e => `- [${e.category}] ${e.name}: ${e.description}`);
  return [
    "\nREFERENCE — examples of strong extracurriculars from competitive applicants",
    "(for CALIBRATION/INSPIRATION only — do NOT copy these, do NOT attribute them to the student; use them to gauge the depth, leadership, and impact that read as strong):",
    ...lines,
  ].join("\n");
}
