using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    zoho_campaign_id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    city = table.Column<string>(type: "text", nullable: false),
                    activated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_events", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "school_districts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    state = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_school_districts", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "schools",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    district_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schools", x => x.id);
                    table.ForeignKey(
                        name: "fk_schools_school_districts_district_id",
                        column: x => x.district_id,
                        principalTable: "school_districts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "contacts",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    event_id = table.Column<Guid>(type: "uuid", nullable: false),
                    source = table.Column<string>(type: "text", nullable: false),
                    first_name = table.Column<string>(type: "text", nullable: false),
                    last_name = table.Column<string>(type: "text", nullable: false),
                    email = table.Column<string>(type: "text", nullable: true),
                    phone = table.Column<string>(type: "text", nullable: true),
                    school_district_id = table.Column<Guid>(type: "uuid", nullable: false),
                    school_id = table.Column<Guid>(type: "uuid", nullable: true),
                    title = table.Column<string>(type: "text", nullable: true),
                    extraction_confidence = table.Column<string>(type: "text", nullable: true),
                    match_status = table.Column<string>(type: "text", nullable: false),
                    match_confidence = table.Column<string>(type: "text", nullable: true),
                    matched_zoho_contact_id = table.Column<string>(type: "text", nullable: true),
                    matched_zoho_account_id = table.Column<string>(type: "text", nullable: true),
                    candidate_matches = table.Column<string>(type: "jsonb", nullable: true),
                    local_duplicate_of_contact_id = table.Column<Guid>(type: "uuid", nullable: true),
                    review_status = table.Column<string>(type: "text", nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true),
                    source_image_path = table.Column<string>(type: "text", nullable: true),
                    source_image_hash = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_contacts", x => x.id);
                    table.ForeignKey(
                        name: "fk_contacts_contacts_local_duplicate_of_contact_id",
                        column: x => x.local_duplicate_of_contact_id,
                        principalTable: "contacts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_contacts_events_event_id",
                        column: x => x.event_id,
                        principalTable: "events",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_contacts_school_districts_school_district_id",
                        column: x => x.school_district_id,
                        principalTable: "school_districts",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_contacts_schools_school_id",
                        column: x => x.school_id,
                        principalTable: "schools",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_contacts_event_id",
                table: "contacts",
                column: "event_id");

            migrationBuilder.CreateIndex(
                name: "ix_contacts_local_duplicate_of_contact_id",
                table: "contacts",
                column: "local_duplicate_of_contact_id");

            migrationBuilder.CreateIndex(
                name: "ix_contacts_school_district_id",
                table: "contacts",
                column: "school_district_id");

            migrationBuilder.CreateIndex(
                name: "ix_contacts_school_id",
                table: "contacts",
                column: "school_id");

            migrationBuilder.CreateIndex(
                name: "ix_contacts_source_image_hash",
                table: "contacts",
                column: "source_image_hash",
                unique: true,
                filter: "source_image_hash IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_schools_district_id",
                table: "schools",
                column: "district_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "contacts");

            migrationBuilder.DropTable(
                name: "events");

            migrationBuilder.DropTable(
                name: "schools");

            migrationBuilder.DropTable(
                name: "school_districts");
        }
    }
}
