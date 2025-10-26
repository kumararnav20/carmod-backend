import "dotenv/config.js";
import express from "express";
import pkg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import { Resend } from 'resend';
import aiRoutes from "./routes/aiRoutes.js";
import generateRoutes from "./routes/generateRoutes.js";
import partRoutes from "./routes/partRoutes.js";
// ✅ Google Cloud Storage setup
import { Storage } from "@google-cloud/storage";
import galleryRoutes from "./routes/galleryRoutes.js";


const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
console.log("☁️ Google Cloud Storage configured:", process.env.GCS_BUCKET_NAME);


const { Pool } = pkg;
const app = express();
app.use("/api/gallery", galleryRoutes);

// Get __dirname in ES6 modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ✅ Configure Resend for emails
const resend = new Resend(process.env.RESEND_API_KEY);

console.log('📧 Resend configured:', {
  api_key: process.env.RESEND_API_KEY ? '✅' : '❌'
});

// ✅ Middleware (must be at the top)
app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.FRONTEND_URL
  ],
  credentials: true
})); // Enable CORS for frontend communication
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploaded files
app.use("/api/ai", aiRoutes);
app.use("/api/generate", generateRoutes);
app.use("/api/part", partRoutes);


// ✅ Create uploads folder if it doesn't exist (still needed for temporary storage)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('📁 Created uploads folder');
}

// ✅ Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ Test database connection
pool.connect()
  .then(client => {
    console.log("✅ Connected to Database!");
    client.release();
  })
  .catch(err => console.error("❌ Database connection error:", err));

// ✅ Configure multer for file uploads (temporary local storage before Cloudinary)
const multerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: multerStorage,
  limits: { 
    fileSize: 50 * 1024 * 1024 // 50MB max
  },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') {
      return cb(new Error('Only .glb and .gltf files are allowed!'));
    }
    cb(null, true);
  }
});

// ✅ Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Please login.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// ✅ Calculate current competition week (1-10)
function getCurrentWeek() {
  const startDate = new Date('2025-10-07'); // ⚠️ CHANGE THIS to your competition start date!
  const now = new Date();
  const diffTime = now - startDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const weekNumber = Math.floor(diffDays / 7) + 1;
  
  if (weekNumber < 1) return 0; // Competition hasn't started
  if (weekNumber > 10) return 11; // Competition ended
  
  return weekNumber;
}

// ✅ Root route
app.get("/", (req, res) => {
  res.send("CarMod Showdown Backend Running 🚗");
});

// ---------------------------
// 🧍 User Registration
// ---------------------------
app.post("/api/register", async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id, email, username",
      [email, username, hashedPassword]
    );
    res.status(201).json({
      message: "User registered successfully!",
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    if (err.code === "23505") {
      res.status(400).json({ error: "Email already registered" });
    } else {
      res.status(500).json({ error: "Registration failed" });
    }
  }
});

// ---------------------------
// 🔐 User Login
// ---------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "All fields are required" });
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)
      return res.status(400).json({ error: "User not found" });
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({ message: "Login successful", token, userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ---------------------------
// 📤 Upload Custom Part (WITH CLOUDINARY & EMAIL!)
// ---------------------------
app.post("/api/upload-part", authenticateToken, upload.single('file'), async (req, res) => {
  try {
    console.log('📤 Upload request received');
    console.log('👤 User:', req.user);
    console.log('📝 Body:', req.body);
    console.log('📁 File:', req.file);

    const { userName, email, partName, partType, carModel, description } = req.body;
    const file = req.file;

    // Validation
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!partName || !partType || !carModel) {
      return res.status(400).json({ error: 'Missing required fields: partName, partType, carModel' });
    }

    // Get current week
    const weekNumber = getCurrentWeek();

    if (weekNumber === 0) {
      // Delete local file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Competition has not started yet!' });
    }

    if (weekNumber === 11) {
      // Delete local file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Competition has ended!' });
    }

   // 🚀 Upload to Google Cloud Storage
console.log("☁️ Uploading to Google Cloud Storage...");

const uniqueFileName = `${Date.now()}-${file.originalname}`;
await bucket.upload(file.path, {
  destination: uniqueFileName,
  gzip: true,
  resumable: false,
  metadata: {
    contentType: "model/gltf-binary",
    cacheControl: "public, max-age=31536000",
  },
});

// Make the file public
await bucket.file(destination).makePublic();


const publicUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destination}`;
console.log("✅ Uploaded to:", publicUrl);

    const fileSize = file.size;

    // Delete the local temporary file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
      console.log('🗑️ Deleted local temporary file');
    }

    // Generate anonymous ID
    const anonymousId = 'ENTRY_' + Date.now().toString().slice(-5);

    // Save to database with Cloudinary URL and voting fields
    const result = await pool.query(
      `INSERT INTO submissions 
       (user_id, user_name, email, part_name, part_type, car_model, description, file_path, file_size, week_number, status, anonymous_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) 
       RETURNING *`,
      [
        req.user.id,
        userName,
        email,
        partName,
        partType,
        carModel,
        description || '',
        publicUrl,
        fileSize,
        weekNumber,
        'PENDING', // New submissions start as PENDING
        anonymousId
      ]
    );

    console.log('💾 Submission saved to database:', result.rows[0]);

    // 📧 Send confirmation email
    try {
      await resend.emails.send({
        from: 'CarMod Showdown <onboarding@resend.dev>',
        to: email,
        subject: '✅ Submission Received - Vote to Qualify!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #FF9800; font-size: 32px;">🎉 Submission Received!</h1>
            
            <p style="font-size: 18px;">Hi <strong>${userName}</strong>,</p>
            
            <p style="font-size: 16px;">Thank you for submitting your custom car part to the CarMod Showdown competition!</p>
            
            <div style="background: #fff3e0; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #FF9800;">
              <h2 style="margin-top: 0; color: #e65100; font-size: 24px;">⚠️ IMPORTANT: Vote to Qualify!</h2>
              <p style="font-size: 16px;">Your entry is currently <strong>PENDING</strong>. To qualify for winning, you must:</p>
              <p style="font-size: 18px; color: #e65100;"><strong>👉 Vote on 25 other entries</strong></p>
              <p style="font-size: 14px; color: #666;">This ensures fair participation and that everyone's entry gets equal exposure!</p>
            </div>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="margin-top: 0; color: #333; font-size: 24px;">📋 Your Submission Details:</h2>
              <p style="font-size: 16px;"><strong>Anonymous ID:</strong> ${anonymousId}</p>
              <p style="font-size: 16px;"><strong>Part Name:</strong> ${partName}</p>
              <p style="font-size: 16px;"><strong>Part Type:</strong> ${partType}</p>
              <p style="font-size: 16px;"><strong>Car Model:</strong> ${carModel}</p>
              <p style="font-size: 16px;"><strong>Week Number:</strong> ${weekNumber}</p>
              <p style="font-size: 16px;"><strong>Status:</strong> ⏳ Pending (Vote to qualify!)</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="YOUR_WEBSITE_URL/vote" style="display: inline-block; background: #4CAF50; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold;">
                🗳️ Start Voting Now
              </a>
            </div>
            
            <h3 style="color: #4CAF50; font-size: 22px;">🏆 What Happens Next?</h3>
            <ul style="font-size: 16px; line-height: 1.8;">
              <li><strong>Vote on 25 entries</strong> to qualify your submission</li>
              <li>Once qualified, your entry becomes eligible to win</li>
              <li>Winners are selected based on community votes (approval rating)</li>
              <li>Winners receive <strong>Lifetime Premium Access</strong>!</li>
            </ul>
            
            <p style="margin-top: 30px; font-size: 16px;">Good luck! 🍀</p>
            
            <p style="color: #888; font-size: 14px; margin-top: 40px;">
              CarMod Showdown - Fair & Square Competition
            </p>
          </div>
        `
      });
      console.log('✅ Confirmation email sent to:', email);
    } catch (emailError) {
      console.error('⚠️ Failed to send confirmation email:', emailError);
      // Don't fail the upload if email fails
    }

    res.json({ 
      success: true, 
      message: '✅ Submission received! Vote on 25 entries to qualify for winning.',
      submission: {
        id: result.rows[0].id,
        anonymousId: anonymousId,
        partName: result.rows[0].part_name,
        weekNumber: result.rows[0].week_number,
        status: result.rows[0].status,
        fileUrl: publicUrl,
        votesRequired: 25,
        votesCompleted: 0
      }
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    
    // Delete uploaded file if anything fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
      console.log('🗑️ Deleted failed upload file');
    }
    
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// ========================================
// 🗳️ VOTING SYSTEM API ENDPOINTS
// ========================================

// 1️⃣ GET voting batch - Get 25 entries to vote on
app.get('/api/voting/batch/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  
  try {
    // Get 25 entries user hasn't voted on yet
    // Prioritize entries with lowest times_shown for fairness
    const result = await pool.query(`
      SELECT * FROM submissions 
      WHERE user_id != $1
        AND id NOT IN (
          SELECT submission_id FROM user_votes WHERE voter_id = $1
        )
        AND status = 'QUALIFIED'
      ORDER BY times_shown ASC, RANDOM()
      LIMIT 25
    `, [userId]);
    
    const entries = result.rows;
    
    // If no qualified entries, return pending entries (for early voting)
    if (entries.length === 0) {
      const pendingResult = await pool.query(`
        SELECT * FROM submissions 
        WHERE user_id != $1
          AND id NOT IN (
            SELECT submission_id FROM user_votes WHERE voter_id = $1
          )
        ORDER BY times_shown ASC, RANDOM()
        LIMIT 25
      `, [userId]);
      
      const pendingEntries = pendingResult.rows;
      
      // Mark as shown
      for (const entry of pendingEntries) {
        await pool.query(
          'UPDATE submissions SET times_shown = times_shown + 1 WHERE id = $1',
          [entry.id]
        );
      }
      
      return res.json({ 
        success: true,
        entries: pendingEntries 
      });
    }
    
    // Mark as shown
    for (const entry of entries) {
      await pool.query(
        'UPDATE submissions SET times_shown = times_shown + 1 WHERE id = $1',
        [entry.id]
      );
    }
    
    res.json({ 
      success: true,
      entries: entries 
    });
    
  } catch (error) {
    console.error('Error getting voting batch:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get voting batch' 
    });
  }
});

// 2️⃣ POST vote - Submit a vote
app.post('/api/vote', authenticateToken, async (req, res) => {
  const { voterId, submissionId, voteValue } = req.body;
  
  try {
    // Record vote
    await pool.query(`
      INSERT INTO user_votes (voter_id, submission_id, vote_value)
      VALUES ($1, $2, $3)
      ON CONFLICT (voter_id, submission_id) DO NOTHING
    `, [voterId, submissionId, voteValue]);
    
    // Update submission stats
    if (voteValue === 1) {
      await pool.query(
        'UPDATE submissions SET thumbs_up = thumbs_up + 1, total_votes = total_votes + 1 WHERE id = $1',
        [submissionId]
      );
    } else {
      await pool.query(
        'UPDATE submissions SET thumbs_down = thumbs_down + 1, total_votes = total_votes + 1 WHERE id = $1',
        [submissionId]
      );
    }
    
    // Check if voter has their own submission
    const voterSubmissionResult = await pool.query(
      'SELECT * FROM submissions WHERE user_id = $1',
      [voterId]
    );
    
    let qualified = false;
    let voteCount = 0;
    
    if (voterSubmissionResult.rows.length > 0) {
      const voterSubmission = voterSubmissionResult.rows[0];
      
      // Count total votes by this user
      const voteCountResult = await pool.query(
        'SELECT COUNT(*) as count FROM user_votes WHERE voter_id = $1',
        [voterId]
      );
      
      voteCount = parseInt(voteCountResult.rows[0].count);
      
      // Update their submission's qualification progress
      await pool.query(
        'UPDATE submissions SET votes_completed = $1 WHERE user_id = $2',
        [voteCount, voterId]
      );
      
      // If reached 25 votes, QUALIFY the entry!
      if (voteCount >= 25 && voterSubmission.status === 'PENDING') {
        await pool.query(
          `UPDATE submissions 
           SET status = 'QUALIFIED', qualified_at = NOW() 
           WHERE user_id = $1`,
          [voterId]
        );
        
        qualified = true;
      }
    }
    
    res.json({
      success: true,
      message: qualified ? '🎉 YOUR ENTRY IS NOW QUALIFIED TO WIN!' : 'Vote recorded',
      votesCompleted: voteCount,
      votesRequired: 25,
      qualified: qualified
    });
    
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to submit vote' 
    });
  }
});

// 3️⃣ GET submission status - Check if user's submission is qualified
app.get('/api/submission/status/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        submission: null,
        votesCompleted: 0
      });
    }
    
    const submission = result.rows[0];
    
    // Get vote count
    const voteCountResult = await pool.query(
      'SELECT COUNT(*) as count FROM user_votes WHERE voter_id = $1',
      [userId]
    );
    
    const votesCompleted = parseInt(voteCountResult.rows[0].count);
    
    res.json({
      success: true,
      submission: submission,
      votesCompleted: votesCompleted
    });
    
  } catch (error) {
    console.error('Error getting submission status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get submission status' 
    });
  }
});

// 4️⃣ GET winners - Get qualified winners based on approval rating
app.get('/api/winners/:weekNumber', async (req, res) => {
  const { weekNumber } = req.params;
  
  try {
    // Get total voters
    const totalVotersResult = await pool.query(
      'SELECT COUNT(DISTINCT voter_id) as count FROM user_votes'
    );
    const totalVoters = parseInt(totalVotersResult.rows[0].count);
    
    // 20% threshold
    const minimumVotes = Math.max(Math.ceil(totalVoters * 0.20), 1);
    
    // Get winners
    const result = await pool.query(`
      SELECT *,
        CASE 
          WHEN total_votes > 0 THEN (thumbs_up::FLOAT / total_votes * 100)
          ELSE 0
        END as approval_rating
      FROM submissions
      WHERE week_number = $1
        AND status = 'QUALIFIED'
        AND total_votes >= $2
      ORDER BY approval_rating DESC, total_votes DESC
      LIMIT 10
    `, [weekNumber, minimumVotes]);
    
    res.json({
      success: true,
      winners: result.rows,
      minimumVotes: minimumVotes
    });
    
  } catch (error) {
    console.error('Error getting winners:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get winners' 
    });
  }
});

// ---------------------------
// 📋 Get User's Own Submissions
// ---------------------------
app.get("/api/my-submissions", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, part_name, part_type, car_model, description, file_size, file_path,
              week_number, status, is_winner, anonymous_id, votes_completed, votes_required,
              times_shown, thumbs_up, thumbs_down, total_votes, 
              CASE 
                WHEN total_votes > 0 THEN (thumbs_up::FLOAT / total_votes * 100)
                ELSE 0
              END as approval_rating,
              created_at 
       FROM submissions 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ submissions: result.rows });
  } catch (error) {
    console.error('Error fetching submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// ---------------------------
// 🏆 Get Weekly Winners (Public)
// ---------------------------
app.get("/api/weekly-winners", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.part_name, s.part_type, s.car_model, s.user_name, 
              s.week_number, s.created_at, s.file_path, s.anonymous_id,
              s.thumbs_up, s.total_votes,
              CASE 
                WHEN s.total_votes > 0 THEN (s.thumbs_up::FLOAT / s.total_votes * 100)
                ELSE 0
              END as approval_rating
       FROM submissions s
       WHERE s.is_winner = true
       ORDER BY s.week_number DESC`
    );
    res.json({ winners: result.rows });
  } catch (error) {
    console.error('Error fetching winners:', error);
    res.status(500).json({ error: 'Failed to fetch winners' });
  }
});

// ---------------------------
// 📊 Get Competition Stats (Public)
// ---------------------------
app.get("/api/competition-stats", async (req, res) => {
  try {
    const currentWeek = getCurrentWeek();
    
    const totalSubmissions = await pool.query('SELECT COUNT(*) FROM submissions');
    const weeklySubmissions = await pool.query(
      'SELECT COUNT(*) FROM submissions WHERE week_number = $1',
      [currentWeek]
    );
    const totalWinners = await pool.query('SELECT COUNT(*) FROM submissions WHERE is_winner = true');
    const qualifiedEntries = await pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'QUALIFIED'");
    
    res.json({
      currentWeek: currentWeek,
      totalSubmissions: parseInt(totalSubmissions.rows[0].count),
      weeklySubmissions: parseInt(weeklySubmissions.rows[0].count),
      totalWinners: parseInt(totalWinners.rows[0].count),
      qualifiedEntries: parseInt(qualifiedEntries.rows[0].count),
      competitionStatus: currentWeek === 0 ? 'Not Started' : currentWeek === 11 ? 'Ended' : 'Active'
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ---------------------------
// 🔧 Admin: View All Submissions
// ---------------------------
app.get("/api/admin/submissions", authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    const adminResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    
    if (!adminResult.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await pool.query(
      `SELECT s.*, u.username, u.email as user_email,
              CASE 
                WHEN s.total_votes > 0 THEN (s.thumbs_up::FLOAT / s.total_votes * 100)
                ELSE 0
              END as approval_rating
       FROM submissions s 
       JOIN users u ON s.user_id = u.id 
       ORDER BY s.created_at DESC`
    );
    
    res.json({ submissions: result.rows });
  } catch (error) {
    console.error('Error fetching admin submissions:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// ---------------------------
// 🏆 Admin: Select Winner (WITH EMAIL!)
// ---------------------------
app.post("/api/admin/select-winner/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is admin
    const adminResult = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    
    if (!adminResult.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Update submission as winner
    const result = await pool.query(
      'UPDATE submissions SET is_winner = true, status = $1 WHERE id = $2 RETURNING *',
      ['winner', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const winner = result.rows[0];
    console.log('🏆 Winner selected:', winner);

    // 📧 Send winner notification email
    try {
      await resend.emails.send({
        from: 'CarMod Showdown <onboarding@resend.dev>',
        to: winner.email,
        subject: '🏆 YOU WON! CarMod Week ' + winner.week_number + ' Winner!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 12px;">
            <div style="background: white; padding: 40px; border-radius: 8px;">
              <h1 style="color: #FFD700; text-align: center; font-size: 42px; margin-top: 0;">
                🏆 CONGRATULATIONS! 🏆
              </h1>
              
              <p style="font-size: 24px; text-align: center; color: #333;">
                <strong>${winner.user_name}</strong>, you are the <strong>Week ${winner.week_number} Winner!</strong>
              </p>
              
              <div style="background: #f0f8ff; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #FFD700;">
                <h2 style="margin-top: 0; color: #333; font-size: 26px;">🎉 Your Winning Submission:</h2>
                <p style="font-size: 18px;"><strong>Part Name:</strong> ${winner.part_name}</p>
                <p style="font-size: 18px;"><strong>Part Type:</strong> ${winner.part_type}</p>
                <p style="font-size: 18px;"><strong>Car Model:</strong> ${winner.car_model}</p>
              </div>
              
              <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 30px 0;">
                <h2 style="margin-top: 0; color: #2e7d32; font-size: 26px;">🎁
Your Prizes:</h2>
                <ul style="font-size: 18px; line-height: 1.8;">
                  <li>✅ <strong>Lifetime Premium Access</strong> - Activated NOW!</li>
                  <li>✅ <strong>Unlimited Customizations</strong></li>
                  <li>✅ <strong>Access to Full Part Library</strong></li>
                  <li>✅ <strong>Free Entry to ALL Future Competitions</strong></li>
                  <li>✅ <strong>Featured as Creator of the Week</strong></li>
                  <li>✅ <strong>Eligible for £50 Grand Prize</strong></li>
                </ul>
              </div>
              
              <div style="text-align: center; margin: 40px 0;">
                <p style="font-size: 22px; color: #333;">Your premium account is now <strong style="color: #4CAF50;">ACTIVE</strong>!</p>
                <p style="color: #666; font-size: 16px;">Login to access all your premium features</p>
              </div>
              
              <p style="text-align: center; color: #888; font-size: 16px; margin-top: 40px;">
                Keep creating amazing customizations!<br/>
                You can still win the £50 Grand Prize for best overall submission!
              </p>
            </div>
          </div>
        `
      });
      console.log('✅ Winner notification email sent to:', winner.email);
    } catch (emailError) {
      console.error('⚠️ Failed to send winner email:', emailError);
      // Still return success even if email fails
    }
    
    res.json({ 
      success: true, 
      message: 'Winner selected successfully! Email notification sent.',
      winner: result.rows[0]
    });
  } catch (error) {
    console.error('Error selecting winner:', error);
    res.status(500).json({ error: 'Failed to select winner' });
  }
});

// ---------------------------
// 📸 Gallery - Get all submissions
// ---------------------------
app.get('/api/gallery', async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        user_name,
        email,
        part_name,
        part_type,
        car_model,
        description,
        file_path,
        file_size,
        week_number,
        status,
        is_winner,
        anonymous_id,
        times_shown,
        thumbs_up,
        thumbs_down,
        total_votes,
        CASE 
          WHEN total_votes > 0 THEN (thumbs_up::FLOAT / total_votes * 100)
          ELSE 0
        END as approval_rating,
        created_at
      FROM submissions
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      submissions: result.rows
    });
  } catch (error) {
    console.error('Gallery fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions'
    });
  }
});

// ✅ Server Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));