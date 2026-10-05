<template>
  <!-- The opt-in disclosure for texting us. It has to be on the same screen as the
       action that gives consent, directly under it, and never collapsed: our texting
       campaign was rejected four times over this. It is its own component so the
       wording exists once, and every place that offers the action (Setup's phone card,
       the onboarding's quick start) shows exactly this. It covers texting SETUP and any
       text that links a phone alike. -->
  <div class="text-caption text-grey-8 q-mt-md">
    By texting this code, you agree to receive recurring automated text messages from
    Flippen Group related to conference lead capture. Msg&amp;data rates may apply. Msg
    frequency varies. Reply HELP for help, STOP to cancel.
  </div>
</template>
