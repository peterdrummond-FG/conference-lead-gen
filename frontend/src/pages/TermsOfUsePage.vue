<template>
  <q-page class="q-pa-lg flex flex-center">
    <router-link to="/login" class="app-logo-link">Conference Lead Intake</router-link>
    <q-card style="width: 720px; max-width: 92vw" class="q-pa-md">
      <q-card-section>
        <div class="text-h5">Terms &amp; Conditions</div>
        <div class="text-caption text-grey">Flippen Group Conference Lead Gen</div>
        <div class="text-caption text-grey">Last updated September 2026</div>
      </q-card-section>

      <q-card-section class="text-body2 q-gutter-md">
        <p>
          This application ("the Site") is provided by Flippen Group. By using the Site, including its
          conference intake form and its "Flippen Group Conference Lead Capture" SMS program, you agree
          to these Terms &amp; Conditions. Please also review our
          <router-link to="/privacy">Privacy Policy</router-link>.
        </p>

        <div>
          <div class="text-subtitle2 text-weight-bold">Copyrights</div>
          <p>
            All content and functionality on the Site, including text, graphics, logos, icons, and
            images, belongs to Flippen Group or its licensors and is protected under U.S. and
            international copyright law.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Trademarks</div>
          <p>
            You may not reference or attribute information to Flippen Group for advertising or
            promotional purposes, or imply our endorsement, without our prior written permission.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Use of Site Content</div>
          <p>
            We grant you a limited license to access and use the Site solely for its intended business
            purpose. Reproduction, distribution, or transmission of Site content for any other purpose
            requires our prior written approval.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: Description</div>
          <p>
            "Flippen Group Conference Lead Capture" is an SMS-based tool that lets Flippen Group field
            sales representatives activate a conference and submit attendee contact information —
            business-card photos and voice-memo notes — by text message. This program is intended
            solely for use by Flippen Group employees and authorized representatives in the course of
            their job duties; it is not a consumer marketing program, and phone numbers are not
            collected from the general public.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: How to Sign Up</div>
          <p>
            Text <span class="text-weight-bold">SETUP</span> to
            <span class="text-weight-bold">+1 (936) 218-1311</span> to activate the program. By texting
            SETUP, you agree to receive recurring automated text messages from Flippen Group related to
            conference lead capture. (Once a conference is active, you may also text that day's event
            code directly to the same number instead of SETUP — the same consent applies.)
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: Message Frequency</div>
          <p>Message frequency varies based on how a representative uses the program.</p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: Cost</div>
          <p>Msg &amp; data rates may apply.</p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: How to Opt Out</div>
          <p>
            <strong>Reply STOP at any time to cancel.</strong> You will receive one final confirmation
            message and no further messages. To resume, text SETUP again.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: Help</div>
          <p>
            <strong>Reply HELP at any time for help</strong>, or contact the Flippen Group Legal
            Department at 979-693-7660.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS Program: Carrier Disclaimer</div>
          <p>Carriers are not liable for delayed or undelivered messages.</p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Disclaimers</div>
          <p>
            The Site is provided "as is" without warranties of any kind. Flippen Group disclaims
            liability for any third-party content and any linked websites.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Third-Party Websites</div>
          <p>Flippen Group assumes no responsibility for the content of external websites linked from the Site.</p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Changes to These Terms</div>
          <p>
            Flippen Group may update these terms from time to time. Continued use of the Site after an
            update constitutes acceptance of the revised terms.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Governing Law</div>
          <p>These terms are governed by the laws of the State of Texas, without regard to conflict-of-law principles.</p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Contact Us</div>
          <p>
            Flippen Group Legal Department<br />
            1199 Haywood Drive, College Station, TX 77845<br />
            979-693-7660
          </p>
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.app-logo-link {
  position: fixed;
  top: 16px;
  left: 16px;
  font-weight: 700;
  color: var(--q-primary);
  text-decoration: none;
}
</style>
