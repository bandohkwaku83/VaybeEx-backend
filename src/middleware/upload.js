const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_FLYER_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png'];
const ALLOWED_FLYER_MIMES = [...ALLOWED_IMAGE_MIMES, 'application/pdf'];

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(UPLOAD_ROOT);

const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('Only JPG and PNG images are allowed'));
};

const tripMediaFileFilter = (req, file, cb) => {
  if (file.fieldname === 'flyer') {
    if (ALLOWED_FLYER_MIMES.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Flyer must be a JPG, PNG, or PDF file'));
    return;
  }

  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('Trip images must be JPG or PNG'));
};

const createStorage = () =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const userId = req.user?.userId || 'pending';
      const dir = path.join(UPLOAD_ROOT, 'organizers', String(userId));
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext =
        path.extname(file.originalname).toLowerCase() ||
        (file.mimetype === 'image/png' ? '.png' : '.jpg');
      const prefix =
        file.fieldname === 'nationalIdPhoto'
          ? 'national-id'
          : file.fieldname === 'brandLogo'
            ? 'brand-logo'
            : 'profile';
      cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  });

const createTripStorage = () =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      const organizerId = req.user?.userId || 'pending';
      const tripId = req.params?.id || req.draftTripId || 'new';
      const dir = path.join(UPLOAD_ROOT, 'trips', String(organizerId), String(tripId));
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext =
        path.extname(file.originalname).toLowerCase() ||
        (file.mimetype === 'image/png'
          ? '.png'
          : file.mimetype === 'application/pdf'
            ? '.pdf'
            : '.jpg');
      const prefix =
        file.fieldname === 'coverImage'
          ? 'cover'
          : file.fieldname === 'flyer'
            ? 'flyer'
            : 'gallery';
      cb(null, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  });

const multerOptions = {
  storage: createStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: imageFileFilter,
};

const tripMulterOptions = {
  storage: createTripStorage(),
  limits: { fileSize: MAX_FLYER_SIZE },
  fileFilter: tripMediaFileFilter,
};

const uploadSetupImages = multer(multerOptions).fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'brandLogo', maxCount: 1 },
  { name: 'nationalIdPhoto', maxCount: 1 },
]);

const uploadProfileImages = multer(multerOptions).fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'brandLogo', maxCount: 1 },
]);

const uploadProfilePhoto = multer(multerOptions).single('profilePhoto');

const uploadTripMedia = multer(tripMulterOptions).fields([
  { name: 'coverImage', maxCount: 1 },
  { name: 'gallery', maxCount: 6 },
  { name: 'flyer', maxCount: 1 },
]);

const handleMulterUpload = (middleware) => (req, res, next) => {
  middleware(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.message = 'Each image must be 5 MB or less';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        err.message = 'Unexpected file field uploaded';
      }
    }

    err.statusCode = 400;
    next(err);
  });
};

const toUploadUrl = (absolutePath) => {
  const relative = path.relative(UPLOAD_ROOT, absolutePath).replace(/\\/g, '/');
  return `/uploads/${relative}`;
};

const getUploadedFile = (files, fieldName) => files?.[fieldName]?.[0];

const getUploadedFiles = (files, fieldName) => files?.[fieldName] || [];

const applyTripMediaUploads = (trip, files) => {
  const coverFile = getUploadedFile(files, 'coverImage');
  if (coverFile) {
    trip.coverImage = toUploadUrl(coverFile.path);
  }

  const galleryFiles = getUploadedFiles(files, 'gallery');
  if (galleryFiles.length) {
    const newGalleryUrls = galleryFiles.map((file) => toUploadUrl(file.path));
    trip.gallery = [...(trip.gallery || []), ...newGalleryUrls].slice(0, 6);
  }

  const flyerFile = getUploadedFile(files, 'flyer');
  if (flyerFile) {
    trip.flyer = toUploadUrl(flyerFile.path);
  }
};

module.exports = {
  UPLOAD_ROOT,
  uploadSetupImages: handleMulterUpload(uploadSetupImages),
  uploadProfileImages: handleMulterUpload(uploadProfileImages),
  uploadProfilePhoto: handleMulterUpload(uploadProfilePhoto),
  uploadTripMedia: handleMulterUpload(uploadTripMedia),
  toUploadUrl,
  getUploadedFile,
  getUploadedFiles,
  applyTripMediaUploads,
};
