document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const gameContainer = document.getElementById('game-container');
    const scoreDisplay = document.getElementById('score');
    const finalScoreDisplay = document.getElementById('final-score');
    const startScreen = document.getElementById('start-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const difficultyButtons = document.querySelectorAll('.difficulty-btn');
    const restartButton = document.getElementById('restart-button');

    // ==========================================
    // 1. THREE.JS SCENE SETUP
    // ==========================================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 300, 1500); // Add fog for distance fading

    // Camera perspective: positioned behind and slightly to the left, looking down the tracks
    const camera = new THREE.PerspectiveCamera(50, gameContainer.offsetWidth / gameContainer.offsetHeight, 0.1, 2000);
    camera.position.set(-150, 180, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(gameContainer.offsetWidth, gameContainer.offsetHeight);
    renderer.shadowMap.enabled = true;
    gameContainer.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(-100, 300, -100);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -500;
    dirLight.shadow.camera.right = 1500;
    dirLight.shadow.camera.top = 500;
    dirLight.shadow.camera.bottom = -500;
    scene.add(dirLight);

    // Ground Plane
    const groundGeo = new THREE.PlaneGeometry(3000, 2000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x5a4634 }); // Brown dirt
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    ground.receiveShadow = true;
    scene.add(ground);

    // ==========================================
    // 2. GAME STATE & CONSTANTS
    // ==========================================
    const DIFFICULTY_SETTINGS = {
        easy: { numLanes: 3, initialSpeed: 4.0, speedIncrease: 0.001, spawnBase: 950, spawnVar: 400, logic: 'easy' },
        medium: { numLanes: 4, initialSpeed: 5.5, speedIncrease: 0.003, spawnBase: 800, spawnVar: 300, logic: 'medium' },
        hard: { numLanes: 5, initialSpeed: 7.0, speedIncrease: 0.005, spawnBase: 650, spawnVar: 250, logic: 'hard' }
    };

    const PLAYER_X = 100; 
    const RAILCAR_LENGTH = 60;
    const CONNECTION_WIDTH_HORIZONTAL = 160;
    const ENEMY_BUFFER = 250;
    
    // Global Materials
    const playerMat = new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x000000 });
    const enemyMat = new THREE.MeshStandardMaterial({ color: 0xff3333 });
    const connectionMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

    // Dynamic State
    let currentDifficultySettings = null;
    let lastDifficulty = 'medium';
    let currentLanePositions = [];
    let currentLane = 1;
    let gameSpeed = 0;
    let score = 0;
    let isGameOver = true;
    
    let distanceSinceLastSpawn = 0;
    let nextSpawnDistance = 0;
    let animationFrameId = null;
    
    // Arrays for active scene objects
    let enemies = [];
    let connections = [];
    let trackLines = [];
    let trackSleepers = [];

    // ==========================================
    // 3. OBJECT FACTORIES
    // ==========================================
    function createTrainMesh(material) {
        const group = new THREE.Group();
        
        // Train Body
        const bodyGeo = new THREE.BoxGeometry(60, 30, 25);
        const body = new THREE.Mesh(bodyGeo, material);
        body.position.y = 15;
        body.castShadow = true;
        group.add(body);
        
        // Train Roof
        const roofGeo = new THREE.BoxGeometry(64, 5, 29);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = 32.5;
        roof.castShadow = true;
        group.add(roof);
        
        return group;
    }

    // Initialize Player
    let playerMesh = createTrainMesh(playerMat);
    playerMesh.position.x = PLAYER_X;
    scene.add(playerMesh);

    // ==========================================
    // 4. GAME INITIALIZATION & TRACK SETUP
    // ==========================================
    function setupTracks(numLanes, laneSpacing) {
        // Clear previous tracks if restarting
        trackLines.forEach(mesh => scene.remove(mesh));
        trackSleepers.forEach(mesh => scene.remove(mesh));
        trackLines = [];
        trackSleepers = [];

        // Rails
        const railGeo = new THREE.BoxGeometry(3000, 2, 2);
        const railMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.4 });

        currentLanePositions.forEach(z => {
            // Left Rail
            const rail1 = new THREE.Mesh(railGeo, railMat);
            rail1.position.set(500, -8, z - 10);
            scene.add(rail1);
            trackLines.push(rail1);

            // Right Rail
            const rail2 = new THREE.Mesh(railGeo, railMat);
            rail2.position.set(500, -8, z + 10);
            scene.add(rail2);
            trackLines.push(rail2);
        });

        // Wooden Sleepers
        const sleeperGeo = new THREE.BoxGeometry(6, 2, laneSpacing * numLanes);
        const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x3d2817 });
        
        // Create repeating sleepers across the X axis
        for (let i = 0; i < 60; i++) {
            const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
            sleeper.position.set(i * 40 - 200, -9, currentLanePositions[Math.floor(numLanes/2)]);
            scene.add(sleeper);
            trackSleepers.push(sleeper);
        }
    }

    function startGame(difficulty) {
        lastDifficulty = difficulty;
        currentDifficultySettings = DIFFICULTY_SETTINGS[difficulty];
        const numLanes = currentDifficultySettings.numLanes;

        // Calculate dynamic Z-coordinates for lanes based on count
        currentLanePositions = [];
        const laneSpacing = numLanes === 3 ? 60 : numLanes === 4 ? 50 : 40;
        const totalWidth = (numLanes - 1) * laneSpacing;
        for (let i = 0; i < numLanes; i++) {
            currentLanePositions.push((i * laneSpacing) - (totalWidth / 2) + 150); // Offset around Z=150
        }

        isGameOver = false;
        currentLane = Math.floor(numLanes / 2);
        score = 0;
        gameSpeed = currentDifficultySettings.initialSpeed;
        
        // Reset player color/position
        playerMat.emissive.setHex(0x000000);
        playerMesh.position.z = currentLanePositions[currentLane];
        camera.lookAt(400, 0, currentLanePositions[currentLane]);

        // Clean up active obstacles
        enemies.forEach(e => scene.remove(e.mesh));
        connections.forEach(c => scene.remove(c.mesh));
        enemies = [];
        connections = [];

        setupTracks(numLanes, laneSpacing);

        startScreen.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        updateScoreDisplay();

        distanceSinceLastSpawn = 0;
        nextSpawnDistance = 500;
        
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        gameLoop();
    }

    function endGame() {
        isGameOver = true;
        playerMat.emissive.setHex(0xff0000); // Red flash effect on crash
        finalScoreDisplay.textContent = Math.floor(score);
        gameOverScreen.classList.remove('hidden');
    }

    // ==========================================
    // 5. INPUT HANDLING
    // ==========================================
    document.addEventListener('keydown', (e) => {
        if (isGameOver) return;
        const key = e.key.toLowerCase();
        let targetLane = currentLane;
        let moveDirection = null;

        if (key === 'arrowup' || key === 'w' || key === 'arrowleft' || key === 'a') {
            targetLane = currentLane - 1;
            moveDirection = 'up';
        } else if (key === 'arrowdown' || key === 's' || key === 'arrowright' || key === 'd') {
            targetLane = currentLane + 1;
            moveDirection = 'down';
        } else {
            return;
        }

        // Prevent moving out of bounds
        if (targetLane < 0 || targetLane >= currentLanePositions.length) return;

        // Check if player is currently overlapping a connection that goes the intended direction
        for (const conn of connections) {
            // Is player aligned? (Tolerance based on connection width)
            if (Math.abs(PLAYER_X - conn.x) < CONNECTION_WIDTH_HORIZONTAL / 1.5 && conn.direction === moveDirection) {
                // Does this connection link the current lane and target lane?
                if (conn.connects.includes(currentLane) && conn.connects.includes(targetLane)) {
                    currentLane = targetLane;
                    break;
                }
            }
        }
    });

    // ==========================================
    // 6. PROCEDURAL SPAWNING
    // ==========================================
    function createEnemy3D(lane, spawnX) {
        const mesh = createTrainMesh(enemyMat);
        mesh.position.set(spawnX, 0, currentLanePositions[lane]);
        scene.add(mesh);
        enemies.push({ x: spawnX, lane: lane, mesh: mesh });
    }

    function createConnection3D(direction, topLaneIndex, spawnX) {
        const z1 = currentLanePositions[topLaneIndex];
        const z2 = currentLanePositions[topLaneIndex + 1];
        
        const widthX = CONNECTION_WIDTH_HORIZONTAL;
        const depthZ = z2 - z1; // Positive distance between adjacent lanes
        const length = Math.hypot(widthX, depthZ); // Diagonal length
        
        const geo = new THREE.BoxGeometry(length, 4, 20);
        const mesh = new THREE.Mesh(geo, connectionMat);
        
        // Position exactly halfway between the two lanes on Z
        mesh.position.set(spawnX, -8, (z1 + z2) / 2);
        
        // Rotate to connect the lanes diagonally
        const angle = Math.atan2(depthZ, widthX);
        mesh.rotation.y = direction === 'down' ? -angle : angle;
        
        scene.add(mesh);
        connections.push({
            x: spawnX,
            connects: [topLaneIndex, topLaneIndex + 1],
            direction: direction,
            mesh: mesh
        });
    }

    function spawnChallenge() {
        const logic = currentDifficultySettings.logic;
        const numLanes = currentLanePositions.length;
        // Spawn offset way off-screen in the 3D distance
        const spawnX = PLAYER_X + 1100; 

        if (logic === 'easy') {
            let possibleDirs = [];
            if (currentLane > 0) possibleDirs.push('up');
            if (currentLane < numLanes - 1) possibleDirs.push('down');
            if (possibleDirs.length === 0) return;

            const dir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
            const topLane = (dir === 'up') ? currentLane - 1 : currentLane;
            createConnection3D(dir, topLane, spawnX);
            
            // Put enemy exactly in player's path just behind the connection
            createEnemy3D(currentLane, spawnX + CONNECTION_WIDTH_HORIZONTAL + ENEMY_BUFFER);
            return;
        }

        const type = Math.random();
        // Probability distribution for threats
        if (type < 0.4) {
             // Direct Threat
             let possibleDirs = [];
             if (currentLane > 0) possibleDirs.push('up');
             if (currentLane < numLanes - 1) possibleDirs.push('down');
             
             if (possibleDirs.length === 0) { 
                 createEnemy3D(0, spawnX); 
                 return; 
             }
             
             const dir = possibleDirs[Math.floor(Math.random() * possibleDirs.length)];
             const topLane = (dir === 'up') ? currentLane - 1 : currentLane;
             
             createConnection3D(dir, topLane, spawnX);
             createEnemy3D(currentLane, spawnX + CONNECTION_WIDTH_HORIZONTAL + ENEMY_BUFFER);
             
             // Hard mode: sometimes put a second enemy where they are trying to escape to!
             if (logic === 'hard' && Math.random() < 0.3) {
                 const targetLane = (dir === 'up') ? currentLane - 1 : currentLane + 1;
                 createEnemy3D(targetLane, spawnX + CONNECTION_WIDTH_HORIZONTAL + ENEMY_BUFFER + 300);
             }
        } else if (type < 0.75) {
            // Indirect Threat (noise in other lanes)
            let eLane;
            do { eLane = Math.floor(Math.random() * numLanes); } while (eLane === currentLane);
            
            createEnemy3D(eLane, spawnX);
            const dir = Math.random() < 0.5 ? 'up' : 'down';
            const tLane = Math.floor(Math.random() * (numLanes - 1));
            createConnection3D(dir, tLane, spawnX + 300);
        } else {
             // Just a random connection
             const dir = Math.random() < 0.5 ? 'up' : 'down';
             const tLane = Math.floor(Math.random() * (numLanes - 1));
             createConnection3D(dir, tLane, spawnX);
        }
    }

    // ==========================================
    // 7. CORE GAME LOOP
    // ==========================================
    function gameLoop() {
        if (isGameOver) return;

        score += 0.1;
        updateScoreDisplay();

        // 1. Smoothly interpolate player model to their current logical lane
        const targetZ = currentLanePositions[currentLane];
        playerMesh.position.z += (targetZ - playerMesh.position.z) * 0.2;

        // 2. Move & Update Enemies
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            e.x -= gameSpeed;
            e.mesh.position.x = e.x;
            
            // Collision detection
            if (e.lane === currentLane && Math.abs(PLAYER_X - e.x) < RAILCAR_LENGTH) {
                endGame();
                return;
            }
            
            // Cleanup off-screen
            if (e.x < -200) { 
                scene.remove(e.mesh); 
                enemies.splice(i, 1); 
            }
        }

        // 3. Move Connections & Calculate Switchability
        let canSwitch = false;
        for (let i = connections.length - 1; i >= 0; i--) {
            const c = connections[i];
            c.x -= gameSpeed;
            c.mesh.position.x = c.x;

            // Is the player within the valid X bounds of the connection?
            if (Math.abs(PLAYER_X - c.x) < CONNECTION_WIDTH_HORIZONTAL / 1.5) {
                canSwitch = true;
            }
            
            if (c.x < -300) { 
                scene.remove(c.mesh); 
                connections.splice(i, 1); 
            }
        }
        
        // Provide visual feedback (green glow) if a switch is legal
        if (canSwitch) {
            playerMat.emissive.setHex(0x00ff00);
            playerMat.emissiveIntensity = 0.5;
        } else {
            playerMat.emissive.setHex(0x000000);
        }

        // 4. Animate Ground/Tracks (Move sleepers left, loop them right)
        trackSleepers.forEach(sleeper => {
            sleeper.position.x -= gameSpeed;
            if (sleeper.position.x < -200) sleeper.position.x += 2400; 
        });

        // 5. Spawning System
        distanceSinceLastSpawn += gameSpeed;
        if (distanceSinceLastSpawn >= nextSpawnDistance) {
            spawnChallenge();
            distanceSinceLastSpawn = 0;
            
            // Calculate next distance with variance
            const base = currentDifficultySettings.spawnBase;
            const variance = currentDifficultySettings.spawnVar;
            nextSpawnDistance = base + Math.random() * variance;
        }

        // Gradually increase speed
        gameSpeed += currentDifficultySettings.speedIncrease;
        
        // Smooth camera follow logic (wiggles slightly as you switch lanes)
        camera.position.z += (currentLanePositions[currentLane] - camera.position.z) * 0.05;

        // Render Frame
        renderer.render(scene, camera);
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    function updateScoreDisplay() { 
        scoreDisplay.textContent = Math.floor(score); 
    }

    // ==========================================
    // 8. EVENT LISTENERS & RESIZING
    // ==========================================
    difficultyButtons.forEach(btn => btn.addEventListener('click', () => {
        startGame(btn.dataset.difficulty);
    }));
    
    restartButton.addEventListener('click', () => {
        startGame(lastDifficulty);
    });

    window.addEventListener('resize', () => {
        // Keeps the 3D aspect ratio proper if the game container CSS ever changes dynamically
        camera.aspect = gameContainer.offsetWidth / gameContainer.offsetHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(gameContainer.offsetWidth, gameContainer.offsetHeight);
    });

    // ==========================================
    // 9. FULLSCREEN SCALING & MOBILE CONTROLS
    // ==========================================
    const mobileToggleBtn = document.getElementById('mobile-btn');
    const mobileControls = document.getElementById('mobile-controls');
    const mobileUpBtn = document.getElementById('mobile-up');
    const mobileDownBtn = document.getElementById('mobile-down');
    
    function scaleGame() {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        
        if (isFullscreen) {
            const baseWidth = 980;
            const baseHeight = 400; // Original container dimensions
            
            // Calculate scale factor to fit the viewport perfectly
            const scale = Math.min(
                window.innerWidth / baseWidth,
                window.innerHeight / baseHeight
            );
            
            gameContainer.style.transform = `scale(${scale})`;
            document.body.classList.add('mobile-mode'); // Hide borders, lock body
        } else {
            gameContainer.style.transform = 'none'; 
            document.body.classList.remove('mobile-mode');
        }
    }

    function goFull() {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }

    // Dynamic Resizing Listeners
    window.addEventListener("resize", scaleGame);
    window.addEventListener("fullscreenchange", scaleGame);
    window.addEventListener("webkitfullscreenchange", scaleGame);
    mobileToggleBtn.addEventListener('click', goFull);

    // Initial load check
    scaleGame();

    function setupMobileControls() {
        if (!mobileControls) return;

        // Dispatch a fake KeyboardEvent so your existing logic handles it effortlessly
        const triggerKeydown = (keyString) => {
            const event = new KeyboardEvent('keydown', { key: keyString });
            document.dispatchEvent(event);
        };

        const addControlListener = (element, keyString) => {
            const pressKey = (e) => {
                if(e.cancelable) e.preventDefault(); // Stop zooming/scrolling on mobile
                triggerKeydown(keyString);
            };

            // Touch & Mouse bindings
            element.addEventListener('touchstart', pressKey, { passive: false });
            element.addEventListener('mousedown', pressKey);
        };

        // Map mobile buttons to existing keyboard logic strings
        addControlListener(mobileUpBtn, 'ArrowUp');     // Moves left/up a lane
        addControlListener(mobileDownBtn, 'ArrowDown'); // Moves right/down a lane
    }

    setupMobileControls();

});
