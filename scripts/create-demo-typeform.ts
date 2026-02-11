#!/usr/bin/env npx ts-node

/**
 * Creates a simplified Demo Tax Intake Form via Typeform API
 *
 * Usage:
 *   TYPEFORM_API_KEY=your_key npx ts-node scripts/create-demo-typeform.ts
 *
 * Get your API key at: https://admin.typeform.com/user/tokens
 */

const TYPEFORM_API_KEY = process.env.TYPEFORM_API_KEY

if (!TYPEFORM_API_KEY) {
  console.error('Error: TYPEFORM_API_KEY environment variable is required')
  console.error('Get your API key at: https://admin.typeform.com/user/tokens')
  process.exit(1)
}

const formDefinition = {
  title: 'Tax Intake Demo',
  settings: {
    language: 'en',
    is_public: true,
    progress_bar: 'proportion',
    show_progress_bar: true,
    meta: {
      allow_indexing: false
    }
  },
  welcome_screens: [
    {
      ref: 'welcome',
      title: "Welcome! Let's get your tax documents organized.",
      properties: {
        description: 'This quick demo takes about 30 seconds.',
        show_button: true,
        button_text: 'Start'
      }
    }
  ],
  thankyou_screens: [
    {
      ref: 'thank_you',
      title: "Thanks! We'll send you a personalized document checklist shortly.",
      properties: {
        description: 'Check your email for next steps.',
        show_button: true,
        button_text: 'Visit Bodie',
        button_mode: 'redirect',
        redirect_url: 'https://getbodie.ai',
        share_icons: false
      }
    }
  ],
  hidden: ['engagement_id'],

  fields: [
    // Q1: Filing Status
    {
      ref: 'filing_status',
      title: 'What is your filing status?',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: false,
        allow_other_choice: false,
        choices: [
          { ref: 'single', label: 'Single' },
          { ref: 'mfj', label: 'Married Filing Jointly' },
          { ref: 'mfs', label: 'Married Filing Separately' },
          { ref: 'hoh', label: 'Head of Household' }
        ]
      },
      validations: { required: true }
    },

    // Q2: Employment Type
    {
      ref: 'employment_type',
      title: 'How do you earn income? (Select all that apply)',
      type: 'multiple_choice',
      properties: {
        randomize: false,
        allow_multiple_selection: true,
        allow_other_choice: false,
        choices: [
          { ref: 'w2', label: 'W-2 Employee' },
          { ref: 'self_employed', label: 'Self-employed / 1099' },
          { ref: 'investments', label: 'Investment income' },
          { ref: 'retired', label: 'Retired' }
        ]
      },
      validations: { required: true }
    },

    // Q3: Dependents
    {
      ref: 'has_dependents',
      title: 'Do you have any dependents?',
      type: 'yes_no',
      validations: { required: true }
    },

    // Q4: Additional notes
    {
      ref: 'notes',
      title: 'Anything else we should know?',
      type: 'long_text',
      properties: {
        description: 'Optional - any special circumstances'
      },
      validations: { required: false }
    }
  ]
}

async function createForm() {
  console.log('Creating Demo Tax Intake Form...\n')

  const response = await fetch('https://api.typeform.com/forms', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TYPEFORM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(formDefinition)
  })

  if (!response.ok) {
    const error = await response.json()
    console.error('Failed to create form:', JSON.stringify(error, null, 2))
    process.exit(1)
  }

  const form = await response.json()

  console.log('✓ Demo form created successfully!\n')
  console.log('Form ID:', form.id)
  console.log('Form URL:', form._links.display)
  console.log('\nAdd this to your .env:')
  console.log(`TYPEFORM_FORM_ID=${form.id}`)
  console.log('\nWebhook URL to configure in Typeform:')
  console.log(`${process.env.API_URL || 'https://your-api.onrender.com'}/webhooks/typeform`)
}

createForm().catch(console.error)
