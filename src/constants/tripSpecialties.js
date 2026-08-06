const TRIP_SPECIALTIES = [
  'adventure',
  'beach',
  'cultural',
  'wildlife',
  'city',
  'wellness',
  'hiking',
  'camping',
  'road_trip',
  'weekend_getaway',
  'day_trips',
  'food_and_culinary',
  'festivals',
  'music_and_arts',
  'photography',
  'eco_tourism',
  'water_sports',
  'island_hopping',
  'cross_border',
  'group_retreats',
  'family_friendly',
  'luxury',
  'budget_friendly',
];

const TRIP_SPECIALTY_LABELS = {
  adventure: 'Adventure',
  beach: 'Beach & coast',
  cultural: 'Cultural tours',
  wildlife: 'Wildlife & safaris',
  city: 'City experiences',
  wellness: 'Wellness & retreats',
  hiking: 'Hiking & trekking',
  camping: 'Camping',
  road_trip: 'Road trips',
  weekend_getaway: 'Weekend getaways',
  day_trips: 'Day trips',
  food_and_culinary: 'Food & culinary',
  festivals: 'Festivals & events',
  music_and_arts: 'Music & arts',
  photography: 'Photography trips',
  eco_tourism: 'Eco tourism',
  water_sports: 'Water sports',
  island_hopping: 'Island hopping',
  cross_border: 'Cross-border trips',
  group_retreats: 'Group retreats',
  family_friendly: 'Family-friendly',
  luxury: 'Luxury trips',
  budget_friendly: 'Budget-friendly',
};

const parseTripSpecialties = (value) => {
  if (value == null || value === '') return [];

  let items = [];

  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          items = parsed;
        } else {
          items = [trimmed];
        }
      } catch {
        items = trimmed.split(/\r?\n|,/);
      }
    } else {
      items = trimmed.split(/\r?\n|,/);
    }
  } else {
    return [];
  }

  const normalized = [
    ...new Set(
      items
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const invalid = normalized.filter((item) => !TRIP_SPECIALTIES.includes(item));
  if (invalid.length) {
    const error = new Error(
      `Invalid trip specialties: ${invalid.join(', ')}. Allowed: ${TRIP_SPECIALTIES.join(', ')}`
    );
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

module.exports = {
  TRIP_SPECIALTIES,
  TRIP_SPECIALTY_LABELS,
  parseTripSpecialties,
};
