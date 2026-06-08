// ═══════════════════════════════════════════════════════════════════════
// AP CONCEPT CATALOG
// ═══════════════════════════════════════════════════════════════════════
// Per-subject concept components extracted from AP FRQs (2023-2025).
// Each AP subject is broken down into 6-10 essential concepts, where:
//   - Each concept has a weight (weights within a subject sum to ~1.0)
//   - Student AP vector = Σ(concept_mastery_i × weight_i)
//   - Keywords drive classification of student prompts/files to concepts
//
// DESIGN PRINCIPLES:
//   1. Concepts extracted from actual FRQ content (not just course outline)
//   2. Weights reflect relative importance on the exam
//   3. Lazy initialization — concept components are NOT populated for a
//      student until their input (prompt/file) references the AP subject
//   4. Updates propagate immediately when student evidence changes
// ═══════════════════════════════════════════════════════════════════════

export const AP_CONCEPT_CATALOG = Object.freeze({
  // ═══════════════════ STEM — MATHEMATICS ═══════════════════
  AP_CALCULUS_AB: [
    { concept_id: "limits_and_continuity", concept_name: "Limits and Continuity", description: "Evaluating limits, continuity, and analyzing function behavior.", weight: 0.10, keywords: ["limit", "continuity", "asymptote", "approach", "indeterminate"] },
    { concept_id: "derivatives_and_rates", concept_name: "Derivatives and Rates of Change", description: "Computing and interpreting derivatives as instantaneous rates of change.", weight: 0.18, keywords: ["derivative", "rate of change", "slope", "tangent", "differentiate"] },
    { concept_id: "derivative_applications", concept_name: "Applications of Derivatives", description: "Using derivatives for optimization, motion, and related rates.", weight: 0.18, keywords: ["optimization", "related rate", "extrema", "critical point", "maximum", "minimum"] },
    { concept_id: "definite_integrals", concept_name: "Definite Integrals and FTC", description: "Evaluating integrals and applying the Fundamental Theorem of Calculus.", weight: 0.18, keywords: ["integral", "antiderivative", "FTC", "riemann", "accumulation"] },
    { concept_id: "integral_applications", concept_name: "Applications of Integration", description: "Area, volume, and accumulation functions using integrals.", weight: 0.14, keywords: ["area under curve", "volume", "revolution", "accumulated", "total distance"] },
    { concept_id: "differential_equations", concept_name: "Differential Equations", description: "Separable differential equations and slope fields.", weight: 0.10, keywords: ["differential equation", "slope field", "separable", "dy/dx", "initial condition"] },
    { concept_id: "analytical_reasoning", concept_name: "Analytical Justification", description: "Writing mathematical justifications with theorems (MVT, IVT, EVT).", weight: 0.12, keywords: ["justify", "theorem", "MVT", "IVT", "mean value", "intermediate value"] },
  ],

  AP_CALCULUS_BC: [
    { concept_id: "limits_and_continuity", concept_name: "Limits and Continuity", description: "Evaluating limits and analyzing function behavior.", weight: 0.08, keywords: ["limit", "continuity", "asymptote", "indeterminate"] },
    { concept_id: "derivatives_advanced", concept_name: "Advanced Differentiation", description: "Parametric, implicit, logarithmic, and inverse derivatives.", weight: 0.14, keywords: ["derivative", "parametric", "implicit", "logarithmic", "inverse"] },
    { concept_id: "integration_techniques", concept_name: "Integration Techniques", description: "Integration by parts, partial fractions, and improper integrals.", weight: 0.15, keywords: ["integration by parts", "partial fractions", "improper integral", "u-substitution"] },
    { concept_id: "parametric_polar", concept_name: "Parametric and Polar Functions", description: "Analyzing parametric equations, polar coordinates, and vector functions.", weight: 0.13, keywords: ["parametric", "polar", "vector", "curve length", "cartesian"] },
    { concept_id: "series_convergence", concept_name: "Series and Convergence Tests", description: "Infinite series, convergence tests (ratio, comparison, alternating).", weight: 0.15, keywords: ["series", "convergence", "ratio test", "comparison test", "alternating"] },
    { concept_id: "taylor_maclaurin", concept_name: "Taylor and Maclaurin Series", description: "Power series representations and Taylor polynomial approximations.", weight: 0.15, keywords: ["taylor", "maclaurin", "power series", "polynomial approximation", "error bound"] },
    { concept_id: "integral_applications", concept_name: "Applications of Integration", description: "Arc length, surface area, and accumulation in various coordinate systems.", weight: 0.12, keywords: ["arc length", "volume", "accumulation", "surface area"] },
    { concept_id: "differential_equations", concept_name: "Differential Equations", description: "Separable ODEs, Euler's method, and logistic growth.", weight: 0.08, keywords: ["differential equation", "euler", "logistic", "separable"] },
  ],

  AP_PRECALCULUS: [
    { concept_id: "function_composition", concept_name: "Function Composition and Inverses", description: "Composing functions and finding inverses.", weight: 0.12, keywords: ["composition", "inverse", "composite function", "one-to-one"] },
    { concept_id: "function_modeling", concept_name: "Function Type Identification and Modeling", description: "Identifying exponential, polynomial, logarithmic, and rational functions.", weight: 0.14, keywords: ["exponential", "quadratic", "logarithmic", "polynomial", "rational", "fit"] },
    { concept_id: "end_behavior", concept_name: "End Behavior and Limits", description: "Analyzing function behavior as input approaches infinity.", weight: 0.11, keywords: ["end behavior", "limit", "approach", "infinity", "asymptote"] },
    { concept_id: "rate_of_change", concept_name: "Average and Instantaneous Rates of Change", description: "Average rates and introduction to instantaneous rates.", weight: 0.13, keywords: ["rate of change", "average rate", "slope", "instantaneous"] },
    { concept_id: "exponential_logarithmic", concept_name: "Exponential and Logarithmic Functions", description: "Properties and applications of exponential and logarithmic functions.", weight: 0.12, keywords: ["exponential", "logarithm", "decay", "growth", "base"] },
    { concept_id: "trigonometry", concept_name: "Trigonometric Functions and Identities", description: "Trig functions, identities, and periodic modeling.", weight: 0.13, keywords: ["sine", "cosine", "trig", "identity", "periodic", "amplitude", "phase"] },
    { concept_id: "data_modeling", concept_name: "Real-World Data Modeling", description: "Modeling real-world phenomena with appropriate functions.", weight: 0.12, keywords: ["model", "real-world", "application", "data", "prediction"] },
    { concept_id: "matrices_vectors", concept_name: "Matrices and Vectors", description: "Matrix operations, vector arithmetic, and transformations.", weight: 0.13, keywords: ["matrix", "vector", "transformation", "determinant", "linear"] },
  ],

  AP_STATISTICS: [
    { concept_id: "descriptive_statistics", concept_name: "Descriptive Statistics and Data Exploration", description: "Summarizing data with center, spread, shape, and outliers.", weight: 0.14, keywords: ["mean", "median", "standard deviation", "quartile", "boxplot", "histogram", "outlier"] },
    { concept_id: "probability", concept_name: "Probability and Random Variables", description: "Probability rules, conditional probability, and random variable distributions.", weight: 0.15, keywords: ["probability", "conditional", "independent", "random variable", "expected value"] },
    { concept_id: "sampling_methods", concept_name: "Sampling and Experimental Design", description: "Random sampling, experimental design, observational studies, confounding.", weight: 0.15, keywords: ["sample", "random sample", "experiment", "observational", "confounding", "bias", "treatment"] },
    { concept_id: "sampling_distributions", concept_name: "Sampling Distributions", description: "Central Limit Theorem and distribution of sample statistics.", weight: 0.13, keywords: ["sampling distribution", "central limit", "standard error", "normal"] },
    { concept_id: "confidence_intervals", concept_name: "Confidence Intervals", description: "Constructing and interpreting confidence intervals for means and proportions.", weight: 0.14, keywords: ["confidence interval", "margin of error", "critical value", "t-distribution"] },
    { concept_id: "hypothesis_testing", concept_name: "Hypothesis Testing", description: "Significance tests, p-values, and interpreting statistical evidence.", weight: 0.15, keywords: ["hypothesis", "significance", "p-value", "null hypothesis", "alternative", "reject", "type I"] },
    { concept_id: "regression_inference", concept_name: "Inference for Regression", description: "Linear regression models and inference for slopes.", weight: 0.14, keywords: ["regression", "slope", "residual", "correlation", "least squares", "linear model"] },
  ],

  // ═══════════════════ STEM — SCIENCES ═══════════════════
  AP_BIOLOGY: [
    { concept_id: "cell_biology", concept_name: "Cell Structure and Function", description: "Cell membranes, organelles, transport, and cellular compartmentalization.", weight: 0.13, keywords: ["cell", "membrane", "organelle", "transport", "diffusion", "osmosis", "mitochondria"] },
    { concept_id: "cellular_energetics", concept_name: "Cellular Energetics", description: "Photosynthesis, cellular respiration, and enzyme activity.", weight: 0.13, keywords: ["photosynthesis", "respiration", "ATP", "enzyme", "metabolism", "glycolysis", "krebs"] },
    { concept_id: "genetics_inheritance", concept_name: "Heredity and Inheritance", description: "Mendelian genetics, chromosomal inheritance, and pedigree analysis.", weight: 0.13, keywords: ["gene", "allele", "heredity", "inheritance", "mendel", "pedigree", "chromosome"] },
    { concept_id: "molecular_biology", concept_name: "Gene Expression and Regulation", description: "DNA replication, transcription, translation, and gene regulation.", weight: 0.14, keywords: ["DNA", "RNA", "transcription", "translation", "gene expression", "mutation", "protein synthesis"] },
    { concept_id: "evolution", concept_name: "Evolution and Natural Selection", description: "Natural selection, speciation, phylogeny, and evolutionary evidence.", weight: 0.13, keywords: ["evolution", "natural selection", "speciation", "phylogeny", "darwin", "adaptation"] },
    { concept_id: "ecology_ecosystems", concept_name: "Ecology and Ecosystems", description: "Population dynamics, community interactions, and energy flow.", weight: 0.12, keywords: ["ecology", "ecosystem", "population", "community", "trophic", "biodiversity"] },
    { concept_id: "experimental_design", concept_name: "Experimental Design and Analysis", description: "Scientific method, variables, controls, and data interpretation.", weight: 0.12, keywords: ["experiment", "hypothesis", "variable", "control", "data", "graph"] },
    { concept_id: "systems_interactions", concept_name: "Systems and Interactions", description: "Immune response, nervous/endocrine systems, and homeostasis.", weight: 0.10, keywords: ["immune", "nervous", "endocrine", "homeostasis", "signaling", "feedback"] },
  ],

  AP_CHEMISTRY: [
    { concept_id: "atomic_structure", concept_name: "Atomic Structure and Periodicity", description: "Electronic configuration, periodic trends, and atomic properties.", weight: 0.12, keywords: ["atomic", "electron", "orbital", "periodic", "ionization", "electronegativity"] },
    { concept_id: "molecular_bonding", concept_name: "Bonding and Molecular Structure", description: "Ionic, covalent bonds, VSEPR, and intermolecular forces.", weight: 0.13, keywords: ["bond", "ionic", "covalent", "VSEPR", "polarity", "intermolecular", "lewis"] },
    { concept_id: "stoichiometry", concept_name: "Stoichiometry and Chemical Reactions", description: "Balanced equations, moles, limiting reactants, and percent yield.", weight: 0.13, keywords: ["stoichiometry", "mole", "limiting reactant", "percent yield", "balanced equation"] },
    { concept_id: "thermodynamics", concept_name: "Thermodynamics and Energy", description: "Enthalpy, entropy, Gibbs free energy, and spontaneity.", weight: 0.14, keywords: ["enthalpy", "entropy", "gibbs", "free energy", "spontaneous", "calorimetry"] },
    { concept_id: "kinetics", concept_name: "Chemical Kinetics", description: "Reaction rates, rate laws, activation energy, and mechanisms.", weight: 0.12, keywords: ["kinetics", "rate", "rate law", "activation energy", "mechanism", "catalyst"] },
    { concept_id: "equilibrium", concept_name: "Chemical Equilibrium", description: "Equilibrium constants, Le Chatelier's principle, and ICE tables.", weight: 0.13, keywords: ["equilibrium", "Kc", "Kp", "le chatelier", "ICE table", "shift"] },
    { concept_id: "acid_base", concept_name: "Acids, Bases, and Buffers", description: "pH, pKa, buffers, and acid-base titrations.", weight: 0.13, keywords: ["acid", "base", "pH", "pKa", "buffer", "titration", "indicator"] },
    { concept_id: "electrochemistry", concept_name: "Electrochemistry and Redox", description: "Oxidation/reduction, galvanic cells, and electrolysis.", weight: 0.10, keywords: ["redox", "oxidation", "reduction", "galvanic", "electrolysis", "electrode"] },
  ],

  AP_PHYSICS_1: [
    { concept_id: "kinematics", concept_name: "Kinematics and Motion", description: "Position, velocity, acceleration, and motion graphs.", weight: 0.15, keywords: ["kinematics", "velocity", "acceleration", "displacement", "projectile", "motion"] },
    { concept_id: "forces_newton_laws", concept_name: "Newton's Laws and Forces", description: "Free body diagrams, friction, normal forces, and tension.", weight: 0.15, keywords: ["force", "newton", "free body", "friction", "normal force", "tension"] },
    { concept_id: "circular_motion", concept_name: "Circular Motion and Gravitation", description: "Centripetal force, orbital motion, and gravitational attraction.", weight: 0.10, keywords: ["circular", "centripetal", "orbit", "gravitation", "satellite"] },
    { concept_id: "energy_work", concept_name: "Energy and Work", description: "Kinetic/potential energy, work-energy theorem, and conservation.", weight: 0.15, keywords: ["energy", "work", "kinetic", "potential", "conservation", "power"] },
    { concept_id: "momentum", concept_name: "Momentum and Impulse", description: "Conservation of momentum, collisions, and impulse.", weight: 0.13, keywords: ["momentum", "impulse", "collision", "elastic", "inelastic", "conservation"] },
    { concept_id: "rotational_motion", concept_name: "Rotational Motion and Torque", description: "Angular kinematics, torque, moment of inertia, and angular momentum.", weight: 0.14, keywords: ["rotation", "torque", "angular", "moment of inertia", "angular momentum"] },
    { concept_id: "oscillations", concept_name: "Simple Harmonic Motion", description: "Springs, pendulums, and oscillatory systems.", weight: 0.08, keywords: ["oscillation", "SHM", "spring", "pendulum", "period", "frequency", "amplitude"] },
    { concept_id: "experimental_physics", concept_name: "Experimental Design and Graphs", description: "Designing experiments, analyzing data, and interpreting graphs.", weight: 0.10, keywords: ["experiment", "graph", "data", "uncertainty", "linearize", "slope"] },
  ],

  AP_PHYSICS_2: [
    { concept_id: "thermodynamics", concept_name: "Thermodynamics and Ideal Gas Law", description: "Internal energy, work, heat, PV diagrams, and thermal processes.", weight: 0.13, keywords: ["thermodynamics", "temperature", "pressure", "ideal gas", "piston", "thermal"] },
    { concept_id: "fluids", concept_name: "Fluid Mechanics", description: "Pressure, buoyancy, continuity, and Bernoulli's equation.", weight: 0.11, keywords: ["fluid", "pressure", "buoyancy", "bernoulli", "continuity", "density"] },
    { concept_id: "electric_fields", concept_name: "Electric Fields and Forces", description: "Coulomb's law, electric fields, and field lines.", weight: 0.12, keywords: ["electric field", "coulomb", "charge", "field line", "potential"] },
    { concept_id: "circuits", concept_name: "Electric Circuits and Current", description: "Ohm's law, series/parallel circuits, resistance, and power.", weight: 0.12, keywords: ["circuit", "current", "resistance", "voltage", "power", "ohm"] },
    { concept_id: "magnetic_fields", concept_name: "Magnetic Fields and Forces", description: "Magnetic fields, forces on currents, and electromagnetic induction.", weight: 0.13, keywords: ["magnetic field", "force", "current", "wire", "induction", "flux"] },
    { concept_id: "electromagnetic_induction", concept_name: "Electromagnetic Induction", description: "Faraday's law, induced emf, and Lenz's law.", weight: 0.12, keywords: ["induction", "induced", "flux", "faraday", "lenz", "emf"] },
    { concept_id: "geometric_optics", concept_name: "Geometric Optics", description: "Reflection, refraction, lenses, and mirrors.", weight: 0.09, keywords: ["optics", "reflection", "refraction", "lens", "mirror", "snell"] },
    { concept_id: "waves_interference", concept_name: "Waves and Interference", description: "Wave properties, interference, diffraction, and quantum effects.", weight: 0.09, keywords: ["wave", "interference", "diffraction", "photon", "quantum"] },
    { concept_id: "derivations", concept_name: "Mathematical Derivations", description: "Deriving expressions from fundamental principles.", weight: 0.09, keywords: ["derive", "expression", "principle", "equation"] },
  ],

  AP_PHYSICS_C_MECHANICS: [
    { concept_id: "kinematics_calculus", concept_name: "Kinematics with Calculus", description: "Position, velocity, acceleration using derivatives and integrals.", weight: 0.14, keywords: ["kinematics", "derivative", "integral", "velocity", "acceleration", "motion"] },
    { concept_id: "newtons_laws", concept_name: "Newton's Laws with Calculus", description: "Force, friction, variable forces, and differential equations of motion.", weight: 0.15, keywords: ["force", "newton", "differential equation", "friction", "tension"] },
    { concept_id: "work_energy", concept_name: "Work, Energy, and Conservation", description: "Work-energy theorem with integration and conservation laws.", weight: 0.15, keywords: ["work", "energy", "kinetic", "potential", "conservation", "integral"] },
    { concept_id: "momentum_impulse", concept_name: "Momentum, Impulse, Center of Mass", description: "Conservation of momentum, impulse integrals, and center of mass.", weight: 0.14, keywords: ["momentum", "impulse", "collision", "center of mass"] },
    { concept_id: "rotational_dynamics", concept_name: "Rotational Motion with Calculus", description: "Moment of inertia, rotational energy, and angular momentum.", weight: 0.17, keywords: ["rotation", "torque", "angular", "moment of inertia", "rolling"] },
    { concept_id: "oscillations", concept_name: "Oscillations and Differential Equations", description: "SHM as differential equations and damped oscillations.", weight: 0.12, keywords: ["oscillation", "SHM", "differential equation", "damped", "pendulum"] },
    { concept_id: "gravitation", concept_name: "Gravitation and Orbits", description: "Kepler's laws, orbital mechanics, and gravitational potential energy.", weight: 0.13, keywords: ["gravitation", "kepler", "orbit", "satellite", "escape velocity"] },
  ],

  AP_PHYSICS_C_EM: [
    { concept_id: "gauss_law", concept_name: "Gauss's Law and Electric Fields", description: "Applying Gauss's law to derive field expressions.", weight: 0.14, keywords: ["gauss", "electric field", "charge distribution", "symmetry", "flux"] },
    { concept_id: "potential_energy", concept_name: "Electric Potential and Potential Energy", description: "Calculating potential and energy in electric fields.", weight: 0.13, keywords: ["potential", "voltage", "energy", "work", "field"] },
    { concept_id: "capacitance", concept_name: "Capacitance and Dielectrics", description: "Capacitor circuits, dielectrics, and stored energy.", weight: 0.12, keywords: ["capacitance", "capacitor", "dielectric", "stored energy"] },
    { concept_id: "rc_circuits", concept_name: "DC Circuits and Kirchhoff's Laws", description: "Resistor networks, RC circuits, and exponential decay.", weight: 0.13, keywords: ["circuit", "kirchhoff", "RC circuit", "time constant", "exponential"] },
    { concept_id: "magnetic_fields", concept_name: "Magnetic Fields and Forces", description: "Biot-Savart, Ampere's law, and forces on currents.", weight: 0.13, keywords: ["magnetic", "biot-savart", "ampere", "current", "wire"] },
    { concept_id: "faraday_law", concept_name: "Faraday's Law and Magnetic Induction", description: "Induced emf, motional emf, and Lenz's law.", weight: 0.13, keywords: ["faraday", "induction", "emf", "flux", "lenz"] },
    { concept_id: "inductance", concept_name: "Inductance and LC Circuits", description: "Self-inductance, RL circuits, and LC oscillations.", weight: 0.11, keywords: ["inductance", "inductor", "LC circuit", "oscillation", "RL circuit"] },
    { concept_id: "maxwell_equations", concept_name: "Maxwell's Equations and EM Waves", description: "Unified electromagnetism and electromagnetic wave theory.", weight: 0.11, keywords: ["maxwell", "electromagnetic wave", "propagation", "displacement current"] },
  ],

  AP_ENVIRONMENTAL_SCIENCE: [
    { concept_id: "energy_flow", concept_name: "Energy Flow and Trophic Levels", description: "Energy transfer through food chains and ecosystems.", weight: 0.14, keywords: ["energy flow", "trophic", "food chain", "producer", "consumer"] },
    { concept_id: "population_dynamics", concept_name: "Population Dynamics and Growth", description: "Population growth models, K/r-selection, and carrying capacity.", weight: 0.14, keywords: ["population", "growth rate", "K-selected", "r-selected", "carrying capacity"] },
    { concept_id: "biodiversity", concept_name: "Biodiversity and Species Richness", description: "Species diversity, richness, and ecosystem resilience.", weight: 0.13, keywords: ["biodiversity", "species richness", "diversity index", "resilience"] },
    { concept_id: "ecosystem_services", concept_name: "Ecosystem Health and Services", description: "Ecological functions supporting life and human well-being.", weight: 0.12, keywords: ["ecosystem service", "function", "stability", "health"] },
    { concept_id: "habitat_fragmentation", concept_name: "Habitat Fragmentation", description: "How habitat loss and fragmentation affect species.", weight: 0.12, keywords: ["habitat", "fragmentation", "corridor", "isolation"] },
    { concept_id: "data_interpretation", concept_name: "Data Analysis and Trend Identification", description: "Interpreting ecological data and graphs.", weight: 0.13, keywords: ["data", "trend", "graph", "analysis", "correlation"] },
    { concept_id: "experimental_design", concept_name: "Scientific Investigation Design", description: "Designing ecological experiments and identifying variables.", weight: 0.12, keywords: ["experiment", "variable", "control", "hypothesis"] },
    { concept_id: "land_use_impact", concept_name: "Human-Environment Interactions", description: "Human impacts including pollution, land use, and climate change.", weight: 0.10, keywords: ["pollution", "climate", "land use", "impact", "nonnative"] },
  ],

  // ═══════════════════ STEM — COMPUTER SCIENCE ═══════════════════
  AP_COMPUTER_SCIENCE_A: [
    { concept_id: "oop_classes", concept_name: "Object-Oriented Programming and Classes", description: "Class design, constructors, instance variables, and methods.", weight: 0.18, keywords: ["class", "object", "constructor", "instance", "method", "field", "private", "public"] },
    { concept_id: "inheritance_polymorphism", concept_name: "Inheritance and Polymorphism", description: "Subclasses, super, method overriding, and polymorphic behavior.", weight: 0.14, keywords: ["inheritance", "extends", "super", "override", "polymorphism", "subclass"] },
    { concept_id: "arrays_arraylists", concept_name: "Arrays and ArrayLists", description: "1D/2D arrays, ArrayLists, and traversal patterns.", weight: 0.16, keywords: ["array", "arraylist", "2D array", "index", "traverse", "for-each"] },
    { concept_id: "iteration_recursion", concept_name: "Iteration and Recursion", description: "Loops, recursion, and algorithm design.", weight: 0.14, keywords: ["loop", "for", "while", "recursion", "base case", "algorithm"] },
    { concept_id: "method_design", concept_name: "Method Design and Parameters", description: "Static vs instance methods, parameters, return values.", weight: 0.12, keywords: ["method", "static", "parameter", "return", "void", "overload"] },
    { concept_id: "conditional_logic", concept_name: "Conditional Logic and Boolean Expressions", description: "If/else statements and boolean operators.", weight: 0.10, keywords: ["if", "else", "boolean", "&&", "||", "condition"] },
    { concept_id: "strings_wrappers", concept_name: "Strings and Wrapper Classes", description: "String methods, Integer/Double wrappers.", weight: 0.08, keywords: ["string", "substring", "length", "integer", "double", "wrapper"] },
    { concept_id: "debugging_testing", concept_name: "Code Analysis and Debugging", description: "Tracing code execution and identifying bugs.", weight: 0.08, keywords: ["trace", "debug", "error", "output", "analyze"] },
  ],

  AP_COMPUTER_SCIENCE_PRINCIPLES: [
    { concept_id: "program_output", concept_name: "Program Output and Functionality", description: "Predicting and explaining program results.", weight: 0.16, keywords: ["output", "result", "program", "functionality"] },
    { concept_id: "boolean_logic", concept_name: "Boolean Expressions and Conditionals", description: "Evaluating boolean expressions in selection.", weight: 0.16, keywords: ["boolean", "true", "false", "condition", "if"] },
    { concept_id: "logic_errors", concept_name: "Logic Errors and Debugging", description: "Finding and fixing logic errors in code.", weight: 0.16, keywords: ["logic error", "bug", "incorrect", "modification"] },
    { concept_id: "list_manipulation", concept_name: "Lists and Data Structures", description: "List operations and data collection handling.", weight: 0.16, keywords: ["list", "element", "index", "collection"] },
    { concept_id: "procedure_analysis", concept_name: "Procedure Behavior and Modification", description: "Analyzing procedures and their modifications.", weight: 0.16, keywords: ["procedure", "function", "behavior", "modify"] },
    { concept_id: "scalability", concept_name: "Scalability and Code Adaptation", description: "Handling changes in data size or inputs.", weight: 0.10, keywords: ["scale", "adapt", "handle", "additional"] },
    { concept_id: "data_abstraction", concept_name: "Data Abstraction and Representation", description: "Representing data with abstractions like lists.", weight: 0.10, keywords: ["abstraction", "represent", "data", "model"] },
  ],

  // ═══════════════════ HUMANITIES — ENGLISH ═══════════════════
  AP_ENGLISH_LANGUAGE: [
    { concept_id: "rhetorical_analysis", concept_name: "Rhetorical Analysis", description: "Analyzing rhetorical strategies, ethos/pathos/logos, and persuasive techniques.", weight: 0.22, keywords: ["rhetoric", "ethos", "pathos", "logos", "rhetorical", "persuasion", "strategy"] },
    { concept_id: "argumentation", concept_name: "Argumentation and Thesis Development", description: "Constructing arguments with clear thesis and reasoning.", weight: 0.20, keywords: ["argument", "thesis", "claim", "reasoning", "position", "defend"] },
    { concept_id: "synthesis_sources", concept_name: "Synthesis of Sources", description: "Integrating multiple sources to support arguments.", weight: 0.18, keywords: ["synthesis", "source", "integrate", "multiple", "evidence", "cite"] },
    { concept_id: "evidence_commentary", concept_name: "Evidence and Commentary", description: "Using specific textual evidence with explanatory commentary.", weight: 0.15, keywords: ["evidence", "commentary", "textual", "quote", "specific", "example"] },
    { concept_id: "audience_purpose", concept_name: "Audience and Purpose Analysis", description: "Understanding how audience and purpose shape writing.", weight: 0.10, keywords: ["audience", "purpose", "context", "intended reader"] },
    { concept_id: "style_syntax", concept_name: "Style, Diction, and Syntax", description: "Analyzing word choice, sentence structure, and tone.", weight: 0.08, keywords: ["diction", "syntax", "tone", "style", "word choice"] },
    { concept_id: "line_of_reasoning", concept_name: "Line of Reasoning", description: "Building coherent, logical progression of ideas.", weight: 0.07, keywords: ["reasoning", "logic", "coherent", "progression", "organization"] },
  ],

  AP_ENGLISH_LITERATURE: [
    { concept_id: "literary_analysis", concept_name: "Literary Analysis and Interpretation", description: "Analyzing literary works for meaning, theme, and technique.", weight: 0.20, keywords: ["literary", "analysis", "interpretation", "theme", "meaning"] },
    { concept_id: "poetry_analysis", concept_name: "Poetry Analysis", description: "Analyzing form, imagery, figurative language, and speaker in poetry.", weight: 0.18, keywords: ["poem", "poetry", "imagery", "speaker", "stanza", "meter", "figurative"] },
    { concept_id: "prose_analysis", concept_name: "Prose Fiction Analysis", description: "Analyzing narrative technique, character, and plot in prose.", weight: 0.17, keywords: ["prose", "narrative", "character", "plot", "narrator", "point of view"] },
    { concept_id: "thematic_development", concept_name: "Thematic Development", description: "Tracing themes and their development across a work.", weight: 0.15, keywords: ["theme", "motif", "development", "central idea"] },
    { concept_id: "literary_devices", concept_name: "Literary Devices and Techniques", description: "Identifying metaphor, symbolism, irony, and other devices.", weight: 0.12, keywords: ["metaphor", "symbol", "irony", "allusion", "device", "figurative"] },
    { concept_id: "textual_evidence", concept_name: "Textual Evidence and Quotation", description: "Supporting claims with specific textual evidence.", weight: 0.10, keywords: ["evidence", "quote", "textual", "passage", "line"] },
    { concept_id: "literary_argument", concept_name: "Literary Argument and Thesis", description: "Constructing defensible interpretations with clear thesis.", weight: 0.08, keywords: ["thesis", "argument", "interpretation", "claim", "defensible"] },
  ],

  // ═══════════════════ HUMANITIES — HISTORY ═══════════════════
  AP_US_HISTORY: [
    { concept_id: "thesis_argumentation", concept_name: "Thesis and Historical Argumentation", description: "Defensible thesis with historical argumentation.", weight: 0.18, keywords: ["thesis", "argument", "claim", "defensible", "position"] },
    { concept_id: "contextualization", concept_name: "Historical Contextualization", description: "Placing events in broader historical context.", weight: 0.14, keywords: ["context", "broader", "historical", "period", "era"] },
    { concept_id: "document_analysis", concept_name: "Document Analysis (DBQ)", description: "Analyzing primary sources for POV, purpose, and context.", weight: 0.16, keywords: ["document", "source", "POV", "purpose", "audience", "primary source"] },
    { concept_id: "periodization", concept_name: "Periodization and Continuity/Change", description: "Analyzing change over time and continuity.", weight: 0.12, keywords: ["continuity", "change", "period", "over time", "turning point"] },
    { concept_id: "causation", concept_name: "Causation and Historical Causality", description: "Identifying causes and effects of historical events.", weight: 0.12, keywords: ["cause", "effect", "reason", "consequence", "lead to"] },
    { concept_id: "comparison", concept_name: "Comparison Across Time/Place", description: "Comparing historical developments across regions or eras.", weight: 0.10, keywords: ["compare", "contrast", "similar", "different", "both"] },
    { concept_id: "evidence_synthesis", concept_name: "Evidence and Synthesis", description: "Using outside evidence and synthesizing connections.", weight: 0.10, keywords: ["evidence", "synthesis", "connection", "outside evidence"] },
    { concept_id: "us_specific_content", concept_name: "U.S. History Content Knowledge", description: "Knowledge of colonial, revolutionary, Civil War, Progressive, Cold War eras.", weight: 0.08, keywords: ["colonial", "revolution", "civil war", "progressive", "cold war", "constitution"] },
  ],

  AP_WORLD_HISTORY: [
    { concept_id: "thesis_argumentation", concept_name: "Thesis and Historical Argumentation", description: "Defensible thesis with historical reasoning.", weight: 0.18, keywords: ["thesis", "argument", "claim", "defensible"] },
    { concept_id: "contextualization", concept_name: "Historical Contextualization", description: "Situating events in broader global context.", weight: 0.14, keywords: ["context", "global", "broader", "period"] },
    { concept_id: "document_analysis", concept_name: "Document Analysis (DBQ)", description: "Analyzing primary sources globally.", weight: 0.14, keywords: ["document", "source", "POV", "purpose", "audience"] },
    { concept_id: "global_comparison", concept_name: "Cross-Cultural Comparison", description: "Comparing developments across world regions.", weight: 0.14, keywords: ["compare", "region", "empire", "civilization", "cross-cultural"] },
    { concept_id: "continuity_change", concept_name: "Continuity and Change Over Time", description: "Analyzing long-term global transformations.", weight: 0.12, keywords: ["continuity", "change", "over time", "transform"] },
    { concept_id: "causation", concept_name: "Global Causation", description: "Causes and effects of major world historical events.", weight: 0.10, keywords: ["cause", "effect", "consequence", "trigger"] },
    { concept_id: "empire_state_building", concept_name: "Empires and State-Building", description: "Rise and fall of empires, trade networks, and state formation.", weight: 0.10, keywords: ["empire", "state", "trade", "ottoman", "mongol", "han", "roman"] },
    { concept_id: "modern_globalization", concept_name: "Modern Globalization and Conflict", description: "Industrialization, imperialism, world wars, and decolonization.", weight: 0.08, keywords: ["industrialization", "imperialism", "world war", "decolonization", "cold war"] },
  ],

  AP_EUROPEAN_HISTORY: [
    { concept_id: "thesis_argumentation", concept_name: "Thesis and Historical Argumentation", description: "Defensible thesis with European historical reasoning.", weight: 0.18, keywords: ["thesis", "argument", "claim"] },
    { concept_id: "contextualization", concept_name: "Contextualization in European History", description: "Placing events in broader European context.", weight: 0.13, keywords: ["context", "european", "broader"] },
    { concept_id: "document_analysis", concept_name: "Document Analysis (DBQ)", description: "Analyzing primary European sources.", weight: 0.15, keywords: ["document", "source", "POV", "purpose"] },
    { concept_id: "continuity_change", concept_name: "Continuity and Change in Europe", description: "Long-term transformations in European history.", weight: 0.12, keywords: ["continuity", "change", "over time"] },
    { concept_id: "causation", concept_name: "Causation in European Events", description: "Causes and effects of European historical events.", weight: 0.11, keywords: ["cause", "effect", "reason"] },
    { concept_id: "renaissance_reformation", concept_name: "Renaissance and Reformation", description: "Renaissance humanism, Protestant Reformation, religious wars.", weight: 0.10, keywords: ["renaissance", "reformation", "luther", "humanism", "catholic"] },
    { concept_id: "enlightenment_revolution", concept_name: "Enlightenment and Revolutions", description: "Scientific Revolution, Enlightenment, French Revolution, Napoleon.", weight: 0.11, keywords: ["enlightenment", "french revolution", "napoleon", "scientific revolution"] },
    { concept_id: "modern_europe", concept_name: "Industrial and Modern Europe", description: "Industrialization, nationalism, world wars, and Cold War Europe.", weight: 0.10, keywords: ["industrial", "nationalism", "world war", "cold war", "unification"] },
  ],

  // ═══════════════════ SOCIAL SCIENCES ═══════════════════
  AP_PSYCHOLOGY: [
    { concept_id: "biological_bases", concept_name: "Biological Bases of Behavior", description: "Neurons, brain structures, nervous system, and genetics.", weight: 0.14, keywords: ["neuron", "brain", "nervous system", "neurotransmitter", "amygdala", "hippocampus"] },
    { concept_id: "cognition_memory", concept_name: "Cognition and Memory", description: "Memory systems, problem-solving, and cognitive processes.", weight: 0.14, keywords: ["memory", "cognition", "encoding", "retrieval", "working memory", "long-term"] },
    { concept_id: "learning_theories", concept_name: "Learning and Conditioning", description: "Classical and operant conditioning, reinforcement, and observational learning.", weight: 0.13, keywords: ["conditioning", "classical", "operant", "reinforcement", "pavlov", "skinner"] },
    { concept_id: "developmental", concept_name: "Developmental Psychology", description: "Human development across lifespan.", weight: 0.12, keywords: ["development", "piaget", "erikson", "attachment", "lifespan"] },
    { concept_id: "social_psychology", concept_name: "Social Psychology", description: "Attitudes, conformity, group behavior, and persuasion.", weight: 0.13, keywords: ["social", "conformity", "group", "bystander", "attribution", "cognitive dissonance"] },
    { concept_id: "personality_motivation", concept_name: "Personality and Motivation", description: "Personality theories, motivation, and emotion.", weight: 0.12, keywords: ["personality", "motivation", "maslow", "emotion", "big five"] },
    { concept_id: "psychological_disorders", concept_name: "Psychological Disorders and Treatment", description: "Diagnosing disorders and therapeutic approaches.", weight: 0.12, keywords: ["disorder", "depression", "anxiety", "therapy", "DSM", "treatment"] },
    { concept_id: "research_methods", concept_name: "Research Methods and Statistics", description: "Experimental design, validity, and statistical analysis.", weight: 0.10, keywords: ["research", "experiment", "correlation", "validity", "reliability", "sample"] },
  ],

  AP_MACROECONOMICS: [
    { concept_id: "gdp_national_income", concept_name: "GDP and National Income", description: "Measuring economic output, GDP components, and inflation.", weight: 0.16, keywords: ["GDP", "national income", "real GDP", "nominal", "CPI", "inflation"] },
    { concept_id: "unemployment_inflation", concept_name: "Unemployment and Inflation", description: "Unemployment rate, types, and Phillips curve.", weight: 0.12, keywords: ["unemployment", "inflation", "phillips curve", "frictional", "structural"] },
    { concept_id: "aggregate_supply_demand", concept_name: "Aggregate Supply and Demand", description: "AD-AS model and macroeconomic equilibrium.", weight: 0.18, keywords: ["aggregate demand", "aggregate supply", "AD-AS", "equilibrium"] },
    { concept_id: "fiscal_policy", concept_name: "Fiscal Policy", description: "Government spending, taxation, and budget effects.", weight: 0.14, keywords: ["fiscal policy", "government spending", "tax", "deficit", "crowding out"] },
    { concept_id: "monetary_policy", concept_name: "Monetary Policy and the Fed", description: "Central bank tools, interest rates, and money supply.", weight: 0.16, keywords: ["monetary policy", "federal reserve", "interest rate", "money supply", "open market"] },
    { concept_id: "international_trade", concept_name: "International Trade and Exchange Rates", description: "Balance of trade, exchange rates, and global markets.", weight: 0.12, keywords: ["exchange rate", "trade", "imports", "exports", "currency"] },
    { concept_id: "long_run_growth", concept_name: "Long-Run Growth", description: "Economic growth, productivity, and long-run aggregate supply.", weight: 0.12, keywords: ["long run", "growth", "productivity", "capital", "technology"] },
  ],

  AP_MICROECONOMICS: [
    { concept_id: "supply_demand", concept_name: "Supply and Demand", description: "Market equilibrium, surpluses, and price controls.", weight: 0.18, keywords: ["supply", "demand", "equilibrium", "surplus", "shortage", "price"] },
    { concept_id: "elasticity", concept_name: "Elasticity", description: "Price elasticity of demand, supply, and cross-elasticity.", weight: 0.10, keywords: ["elasticity", "inelastic", "elastic", "price sensitivity"] },
    { concept_id: "consumer_producer", concept_name: "Consumer and Producer Surplus", description: "Welfare analysis and deadweight loss.", weight: 0.10, keywords: ["consumer surplus", "producer surplus", "deadweight loss", "welfare"] },
    { concept_id: "production_costs", concept_name: "Production and Costs", description: "Marginal cost, ATC, AVC, and production functions.", weight: 0.15, keywords: ["marginal cost", "ATC", "AVC", "production function", "short run", "long run"] },
    { concept_id: "perfect_competition", concept_name: "Perfect Competition", description: "Competitive market firms and outcomes.", weight: 0.14, keywords: ["perfect competition", "price taker", "MC = MR", "firm"] },
    { concept_id: "imperfect_competition", concept_name: "Monopoly and Imperfect Competition", description: "Monopoly, oligopoly, and monopolistic competition.", weight: 0.15, keywords: ["monopoly", "oligopoly", "monopolistic", "market power"] },
    { concept_id: "factor_markets", concept_name: "Factor Markets", description: "Labor markets, wages, and derived demand.", weight: 0.09, keywords: ["labor market", "wage", "MRP", "factor", "derived demand"] },
    { concept_id: "market_failure", concept_name: "Market Failure and Externalities", description: "Externalities, public goods, and government intervention.", weight: 0.09, keywords: ["externality", "public good", "market failure", "pigovian"] },
  ],

  AP_HUMAN_GEOGRAPHY: [
    { concept_id: "population_migration", concept_name: "Population and Migration", description: "Demographic transition, migration patterns, and population geography.", weight: 0.15, keywords: ["population", "migration", "demographic transition", "fertility", "density"] },
    { concept_id: "cultural_patterns", concept_name: "Cultural Patterns and Processes", description: "Language, religion, and cultural diffusion.", weight: 0.13, keywords: ["culture", "language", "religion", "diffusion", "cultural pattern"] },
    { concept_id: "political_geography", concept_name: "Political Geography", description: "States, boundaries, sovereignty, and supranationalism.", weight: 0.13, keywords: ["state", "nation", "boundary", "sovereignty", "supranational"] },
    { concept_id: "agricultural_geography", concept_name: "Agriculture and Rural Land Use", description: "Agricultural systems, von Thünen, and rural settlement patterns.", weight: 0.15, keywords: ["agriculture", "farm", "von thunen", "rural", "commercial", "subsistence"] },
    { concept_id: "industrial_economic", concept_name: "Industrial and Economic Development", description: "Industrialization, development indicators, and globalization.", weight: 0.15, keywords: ["industry", "development", "GDP", "HDI", "globalization"] },
    { concept_id: "urban_geography", concept_name: "Cities and Urban Land Use", description: "Urbanization, urban models, and city structure.", weight: 0.15, keywords: ["urban", "city", "burgess", "sector", "central place"] },
    { concept_id: "geographic_tools", concept_name: "Geographic Tools and Scale", description: "Maps, scale, geographic data, and spatial analysis.", weight: 0.14, keywords: ["map", "scale", "spatial", "GIS", "location"] },
  ],

  AP_US_GOVERNMENT: [
    { concept_id: "foundational_documents", concept_name: "Foundational Documents", description: "Constitution, Declaration, Federalist Papers, and Bill of Rights.", weight: 0.16, keywords: ["constitution", "federalist", "declaration", "bill of rights", "madison"] },
    { concept_id: "separation_powers", concept_name: "Separation of Powers and Checks/Balances", description: "Branch powers, checks and balances.", weight: 0.13, keywords: ["separation of powers", "checks and balances", "branch", "legislative", "executive", "judicial"] },
    { concept_id: "federalism", concept_name: "Federalism", description: "Division of power between federal and state governments.", weight: 0.12, keywords: ["federalism", "state", "federal", "tenth amendment", "commerce clause"] },
    { concept_id: "civil_rights_liberties", concept_name: "Civil Rights and Liberties", description: "First Amendment, due process, and civil rights cases.", weight: 0.15, keywords: ["civil rights", "first amendment", "due process", "equal protection", "liberty"] },
    { concept_id: "elections_participation", concept_name: "Elections and Political Participation", description: "Voting, parties, and political behavior.", weight: 0.14, keywords: ["election", "voter", "party", "campaign", "turnout"] },
    { concept_id: "branches_institutions", concept_name: "Institutions of Government", description: "Congress, Presidency, Supreme Court, and bureaucracy.", weight: 0.15, keywords: ["congress", "president", "supreme court", "bureaucracy", "institution"] },
    { concept_id: "linkage_institutions", concept_name: "Linkage Institutions and Media", description: "Parties, interest groups, and media in policy process.", weight: 0.08, keywords: ["interest group", "media", "lobbying", "political party"] },
    { concept_id: "supreme_court_cases", concept_name: "Required Supreme Court Cases", description: "Landmark cases like Marbury, Brown, Roe, etc.", weight: 0.07, keywords: ["marbury", "brown", "roe", "supreme court", "precedent"] },
  ],

  AP_COMPARATIVE_GOVERNMENT: [
    { concept_id: "political_systems", concept_name: "Political Systems and Regimes", description: "Democratic, authoritarian, and hybrid regimes.", weight: 0.16, keywords: ["democracy", "authoritarian", "regime", "hybrid", "autocracy"] },
    { concept_id: "six_countries", concept_name: "Six AP Countries Comparison", description: "UK, Russia, China, Iran, Mexico, Nigeria comparative analysis.", weight: 0.20, keywords: ["UK", "russia", "china", "iran", "mexico", "nigeria"] },
    { concept_id: "political_institutions", concept_name: "Political Institutions", description: "Executives, legislatures, judiciaries across systems.", weight: 0.14, keywords: ["parliament", "president", "prime minister", "judiciary", "institution"] },
    { concept_id: "political_participation", concept_name: "Political Participation", description: "Elections, parties, and civil society.", weight: 0.12, keywords: ["election", "party", "civil society", "participation"] },
    { concept_id: "political_culture", concept_name: "Political Culture and Values", description: "Cultural values and their influence on politics.", weight: 0.10, keywords: ["culture", "values", "cleavage", "identity"] },
    { concept_id: "policy_outcomes", concept_name: "Public Policy and Outcomes", description: "Policymaking and policy effects across countries.", weight: 0.12, keywords: ["policy", "outcome", "economic", "social"] },
    { concept_id: "comparative_analysis", concept_name: "Comparative Analysis Methods", description: "Methods for comparing political systems.", weight: 0.16, keywords: ["compare", "contrast", "methodology", "case study"] },
  ],

  // ═══════════════════ SPECIALTY SUBJECTS ═══════════════════
  AP_ART_HISTORY: [
    { concept_id: "visual_analysis", concept_name: "Visual Analysis and Formal Elements", description: "Composition, form, color, line, texture analysis.", weight: 0.18, keywords: ["composition", "form", "line", "color", "texture", "visual"] },
    { concept_id: "artist_identification", concept_name: "Identification and Attribution", description: "Identifying works by title, artist, culture, date.", weight: 0.12, keywords: ["identify", "artist", "culture", "date", "attribution"] },
    { concept_id: "historical_context", concept_name: "Historical and Cultural Context", description: "Contextualizing art in historical circumstances.", weight: 0.18, keywords: ["context", "culture", "historical", "period", "society"] },
    { concept_id: "comparative_analysis", concept_name: "Comparative Analysis", description: "Comparing artworks across style and meaning.", weight: 0.18, keywords: ["compare", "contrast", "similarity", "relationship"] },
    { concept_id: "iconography", concept_name: "Iconography and Symbolism", description: "Interpreting symbols and allegory.", weight: 0.15, keywords: ["symbol", "iconography", "allegory", "meaning", "represent"] },
    { concept_id: "artistic_function", concept_name: "Artistic Function and Purpose", description: "How media and technique convey meaning.", weight: 0.12, keywords: ["function", "purpose", "expression", "effect"] },
    { concept_id: "periodization", concept_name: "Periodization and Movements", description: "Classification of works into periods and styles.", weight: 0.07, keywords: ["period", "movement", "era", "style"] },
  ],

  AP_MUSIC_THEORY: [
    { concept_id: "melodic_dictation", concept_name: "Melodic Dictation and Notation", description: "Transcribing melodies from sound.", weight: 0.16, keywords: ["melody", "notation", "pitch", "transcribe", "key signature"] },
    { concept_id: "harmonic_analysis", concept_name: "Harmonic Analysis with Roman Numerals", description: "Identifying chords and progressions.", weight: 0.18, keywords: ["chord", "harmony", "roman numeral", "progression", "inversion"] },
    { concept_id: "voice_leading", concept_name: "Voice Leading and Part Writing", description: "Four-part composition following traditional rules.", weight: 0.16, keywords: ["voice leading", "soprano", "bass", "part writing", "spacing"] },
    { concept_id: "figured_bass", concept_name: "Figured Bass Realization", description: "Realizing figured bass into four voices.", weight: 0.15, keywords: ["figured bass", "realization", "bass line"] },
    { concept_id: "listening_analysis", concept_name: "Aural Analysis and Transcription", description: "Transcribing harmonic progressions from audio.", weight: 0.18, keywords: ["listen", "aural", "transcribe", "progression"] },
    { concept_id: "chord_identification", concept_name: "Chord Identification and Function", description: "Recognizing chord quality and function.", weight: 0.10, keywords: ["chord type", "major", "minor", "dominant", "tonic"] },
    { concept_id: "musical_form", concept_name: "Musical Form and Structure", description: "Analyzing compositional structure.", weight: 0.07, keywords: ["form", "structure", "sonata", "rondo", "ABA"] },
  ],

  AP_SEMINAR: [
    { concept_id: "argument_identification", concept_name: "Argument Identification and Thesis", description: "Identifying author's main argument.", weight: 0.12, keywords: ["argument", "thesis", "claim", "main idea"] },
    { concept_id: "line_of_reasoning", concept_name: "Line of Reasoning and Claim Development", description: "Building arguments through connected claims.", weight: 0.14, keywords: ["reasoning", "logic", "claim", "connection", "build"] },
    { concept_id: "evidence_evaluation", concept_name: "Evidence Evaluation and Effectiveness", description: "Assessing evidence quality and support.", weight: 0.13, keywords: ["evidence", "effectiveness", "support", "evaluate"] },
    { concept_id: "source_analysis", concept_name: "Source Analysis and Perspective", description: "Evaluating source context, purpose, audience.", weight: 0.12, keywords: ["source", "perspective", "context", "audience", "bias"] },
    { concept_id: "counterarguments", concept_name: "Counterarguments and Nuance", description: "Integrating opposing views.", weight: 0.12, keywords: ["counterargument", "nuance", "qualify", "opposing"] },
    { concept_id: "data_analysis", concept_name: "Quantitative and Qualitative Analysis", description: "Interpreting research data and statistics.", weight: 0.12, keywords: ["data", "research", "statistic", "qualitative"] },
    { concept_id: "synthesis_integration", concept_name: "Synthesis and Idea Integration", description: "Combining multiple sources.", weight: 0.11, keywords: ["synthesis", "integrate", "combine", "multiple"] },
    { concept_id: "claim_support", concept_name: "Supporting Claims with Evidence", description: "Using specific evidence for claims.", weight: 0.14, keywords: ["support", "evidence", "specific", "example"] },
  ],

  AP_AFRICAN_AMERICAN_STUDIES: [
    { concept_id: "historical_evidence", concept_name: "Evidence Analysis and Source Evaluation", description: "Evaluating primary and secondary sources.", weight: 0.14, keywords: ["evidence", "source", "claim", "primary"] },
    { concept_id: "contextual_analysis", concept_name: "Historical Context and Period Analysis", description: "Understanding broader historical contexts.", weight: 0.13, keywords: ["context", "historical", "period", "era"] },
    { concept_id: "cultural_contributions", concept_name: "Cultural and Artistic Contributions", description: "African American cultural achievements.", weight: 0.13, keywords: ["cultural", "artistic", "contribution", "tradition"] },
    { concept_id: "resistance_activism", concept_name: "Resistance, Agency, and Political Activism", description: "Resistance movements and advocacy.", weight: 0.13, keywords: ["resistance", "activism", "agency", "movement"] },
    { concept_id: "discrimination_barriers", concept_name: "Discrimination and Systemic Inequality", description: "Discriminatory systems faced by African Americans.", weight: 0.12, keywords: ["discrimination", "barrier", "segregation", "systemic"] },
    { concept_id: "legacy_continuity", concept_name: "Legacy and Historical Continuity", description: "Connecting events across time periods.", weight: 0.12, keywords: ["legacy", "continuity", "connection"] },
    { concept_id: "perspective_diversity", concept_name: "Diverse Perspectives", description: "Multiple viewpoints in African American history.", weight: 0.11, keywords: ["perspective", "viewpoint", "diverse"] },
    { concept_id: "ancient_africa", concept_name: "Ancient African Societies", description: "West African empires and cultural development.", weight: 0.12, keywords: ["ancient", "african", "empire", "mali", "songhai"] },
  ],

  AP_LATIN: [
    { concept_id: "translation", concept_name: "Latin Translation", description: "Accurate literal translation.", weight: 0.16, keywords: ["translate", "translation", "literal"] },
    { concept_id: "grammar_syntax", concept_name: "Grammar and Syntax", description: "Cases, tenses, and sentence construction.", weight: 0.15, keywords: ["grammar", "syntax", "case", "tense", "conjugation"] },
    { concept_id: "scansion", concept_name: "Scansion and Meter", description: "Poetic meter analysis.", weight: 0.12, keywords: ["scansion", "meter", "dactylic", "hexameter"] },
    { concept_id: "rhetorical_analysis", concept_name: "Rhetorical Devices", description: "Literary devices and stylistic features.", weight: 0.14, keywords: ["rhetorical", "device", "style", "literary"] },
    { concept_id: "textual_evidence", concept_name: "Evidence-Based Analysis", description: "Citing specific Latin passages.", weight: 0.14, keywords: ["evidence", "cite", "line", "passage"] },
    { concept_id: "author_intent", concept_name: "Author Purpose", description: "Understanding authorial intent.", weight: 0.12, keywords: ["purpose", "intent", "author"] },
    { concept_id: "character_analysis", concept_name: "Character Portrayal", description: "Character development in texts.", weight: 0.10, keywords: ["character", "portrayal", "development"] },
    { concept_id: "comparative_texts", concept_name: "Text Comparison", description: "Comparing Latin passages.", weight: 0.07, keywords: ["compare", "passage", "both"] },
  ],

  // ═══════════════════ WORLD LANGUAGES ═══════════════════
  AP_SPANISH_LANGUAGE: [
    { concept_id: "interpersonal_speaking", concept_name: "Interpersonal Speaking", description: "Conversational Spanish communication.", weight: 0.20, keywords: ["conversation", "speaking", "spanish", "respond", "question"] },
    { concept_id: "presentational_speaking", concept_name: "Presentational Speaking", description: "Oral presentations on cultural topics.", weight: 0.18, keywords: ["presentation", "cultural comparison", "oral"] },
    { concept_id: "interpretive_reading", concept_name: "Interpretive Reading", description: "Comprehending written Spanish texts.", weight: 0.18, keywords: ["reading", "comprehension", "text"] },
    { concept_id: "interpretive_listening", concept_name: "Interpretive Listening", description: "Understanding spoken Spanish audio.", weight: 0.14, keywords: ["listening", "audio", "comprehension"] },
    { concept_id: "presentational_writing", concept_name: "Presentational Writing", description: "Essays and persuasive writing in Spanish.", weight: 0.18, keywords: ["essay", "writing", "persuasive", "argument"] },
    { concept_id: "cultural_understanding", concept_name: "Cultural Understanding", description: "Hispanic cultural perspectives and practices.", weight: 0.12, keywords: ["culture", "hispanic", "practice", "perspective"] },
  ],

  AP_FRENCH_LANGUAGE: [
    { concept_id: "interpersonal_speaking", concept_name: "Interpersonal Speaking", description: "Conversational French communication.", weight: 0.20, keywords: ["conversation", "speaking", "french", "respond"] },
    { concept_id: "presentational_speaking", concept_name: "Presentational Speaking", description: "Oral presentations on French cultural topics.", weight: 0.18, keywords: ["presentation", "cultural", "oral"] },
    { concept_id: "interpretive_reading", concept_name: "Interpretive Reading", description: "Comprehending written French texts.", weight: 0.18, keywords: ["reading", "text"] },
    { concept_id: "interpretive_listening", concept_name: "Interpretive Listening", description: "Understanding spoken French.", weight: 0.14, keywords: ["listening", "audio"] },
    { concept_id: "presentational_writing", concept_name: "Presentational Writing", description: "Essays in French.", weight: 0.18, keywords: ["essay", "writing"] },
    { concept_id: "cultural_understanding", concept_name: "Cultural Understanding", description: "Francophone cultural perspectives.", weight: 0.12, keywords: ["culture", "francophone"] },
  ],

  AP_CHINESE_LANGUAGE: [
    { concept_id: "interpersonal_speaking", concept_name: "Interpersonal Speaking", description: "Conversational Mandarin communication.", weight: 0.20, keywords: ["conversation", "speaking", "mandarin", "chinese"] },
    { concept_id: "presentational_speaking", concept_name: "Presentational Speaking", description: "Oral presentations on Chinese cultural topics.", weight: 0.18, keywords: ["presentation", "cultural", "oral"] },
    { concept_id: "interpretive_reading", concept_name: "Interpretive Reading", description: "Comprehending Chinese characters and texts.", weight: 0.18, keywords: ["reading", "character", "hanzi"] },
    { concept_id: "interpretive_listening", concept_name: "Interpretive Listening", description: "Understanding spoken Chinese.", weight: 0.14, keywords: ["listening", "audio"] },
    { concept_id: "presentational_writing", concept_name: "Presentational Writing", description: "Writing in Chinese characters.", weight: 0.18, keywords: ["writing", "essay", "character"] },
    { concept_id: "cultural_understanding", concept_name: "Cultural Understanding", description: "Chinese cultural perspectives.", weight: 0.12, keywords: ["culture", "chinese"] },
  ],
});

// ═══════════════════════════════════════════════════════════
// Helper: Detect which AP subject a text/prompt is about
// ═══════════════════════════════════════════════════════════
const SUBJECT_NAME_PATTERNS = {
  AP_CALCULUS_AB: /\b(calc(ulus)?\s*ab|ap\s*calc\s*ab)\b/i,
  AP_CALCULUS_BC: /\b(calc(ulus)?\s*bc|ap\s*calc\s*bc)\b/i,
  AP_PRECALCULUS: /\b(precalc(ulus)?|pre.calc)\b/i,
  AP_STATISTICS: /\b(ap\s*stat(istic)?s?|statistics)\b/i,
  AP_BIOLOGY: /\b(ap\s*bio(logy)?|biology)\b/i,
  AP_CHEMISTRY: /\b(ap\s*chem(istry)?|chemistry)\b/i,
  AP_PHYSICS_1: /\b(ap\s*physics\s*1|physics\s*1)\b/i,
  AP_PHYSICS_2: /\b(ap\s*physics\s*2|physics\s*2)\b/i,
  AP_PHYSICS_C_MECHANICS: /\b(physics\s*c\s*mechanics|physics\s*c\s*mech)\b/i,
  AP_PHYSICS_C_EM: /\b(physics\s*c\s*(e&m|em|electricity))\b/i,
  AP_ENVIRONMENTAL_SCIENCE: /\b(ap\s*es|environmental\s*science|APES)\b/i,
  AP_COMPUTER_SCIENCE_A: /\b(ap\s*cs(\s*a)?|computer\s*science\s*a|csa)\b/i,
  AP_COMPUTER_SCIENCE_PRINCIPLES: /\b(csp|computer\s*science\s*principles)\b/i,
  AP_ENGLISH_LANGUAGE: /\b(ap\s*eng\s*lang|english\s*language|ap\s*lang)\b/i,
  AP_ENGLISH_LITERATURE: /\b(ap\s*eng\s*lit|english\s*literature|ap\s*lit)\b/i,
  AP_US_HISTORY: /\b(apush|us\s*history|u\.s\.\s*history|american\s*history)\b/i,
  AP_WORLD_HISTORY: /\b(ap\s*world|world\s*history)\b/i,
  AP_EUROPEAN_HISTORY: /\b(ap\s*euro|european\s*history)\b/i,
  AP_PSYCHOLOGY: /\b(ap\s*psych(ology)?|psychology)\b/i,
  AP_MACROECONOMICS: /\b(macro(economics)?|ap\s*macro)\b/i,
  AP_MICROECONOMICS: /\b(micro(economics)?|ap\s*micro)\b/i,
  AP_HUMAN_GEOGRAPHY: /\b(human\s*geography|ap\s*hug|aphg)\b/i,
  AP_US_GOVERNMENT: /\b(us\s*gov(ernment)?|american\s*government|ap\s*gov)\b/i,
  AP_COMPARATIVE_GOVERNMENT: /\b(comparative\s*government|comp\s*gov)\b/i,
  AP_ART_HISTORY: /\b(art\s*history|ap\s*art\s*hist)\b/i,
  AP_MUSIC_THEORY: /\b(music\s*theory|ap\s*music)\b/i,
  AP_SEMINAR: /\b(ap\s*seminar)\b/i,
  AP_AFRICAN_AMERICAN_STUDIES: /\b(african\s*american\s*studies|ap\s*afam)\b/i,
  AP_LATIN: /\b(ap\s*latin|latin)\b/i,
  AP_SPANISH_LANGUAGE: /\b(spanish\s*language|ap\s*spanish)\b/i,
  AP_FRENCH_LANGUAGE: /\b(french\s*language|ap\s*french)\b/i,
  AP_CHINESE_LANGUAGE: /\b(chinese\s*language|mandarin|ap\s*chinese)\b/i,
};

export function detectAPSubject(text) {
  if (!text || typeof text !== "string") return null;
  const matches = [];
  for (const [subjectId, pattern] of Object.entries(SUBJECT_NAME_PATTERNS)) {
    if (pattern.test(text)) {
      matches.push(subjectId);
    }
  }
  return matches.length > 0 ? matches : null;
}

// ═══════════════════════════════════════════════════════════
// Helper: Detect which concepts in a subject a text references
// ═══════════════════════════════════════════════════════════
export function detectConceptsInText(subjectId, text) {
  const catalog = AP_CONCEPT_CATALOG[subjectId];
  if (!catalog || !text) return [];

  const normalizedText = text.toLowerCase();
  const detected = [];

  for (const concept of catalog) {
    let hitCount = 0;
    const hitKeywords = [];
    for (const keyword of concept.keywords) {
      const kw = keyword.toLowerCase();
      if (normalizedText.includes(kw)) {
        hitCount++;
        hitKeywords.push(keyword);
      }
    }
    if (hitCount > 0) {
      // Signal strength: more keyword hits = stronger signal
      const signal = Math.min(1.0, 0.3 + 0.2 * hitCount);
      detected.push({
        concept_id: concept.concept_id,
        concept_name: concept.concept_name,
        weight: concept.weight,
        signal_strength: signal,
        matched_keywords: hitKeywords,
      });
    }
  }

  return detected;
}

// ═══════════════════════════════════════════════════════════
// Helper: Get full concept list for a subject
// ═══════════════════════════════════════════════════════════
export function getConceptsForSubject(subjectId) {
  return AP_CONCEPT_CATALOG[subjectId] || [];
}

export function getAllAPSubjects() {
  return Object.keys(AP_CONCEPT_CATALOG);
}
