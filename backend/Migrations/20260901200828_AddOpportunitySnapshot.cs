using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOpportunitySnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "active_opportunity_name",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "has_active_opportunity",
                table: "contacts",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "matched_zoho_contact_email",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "matched_zoho_contact_phone",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "matched_zoho_contact_title",
                table: "contacts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "active_opportunity_name",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "has_active_opportunity",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "matched_zoho_contact_email",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "matched_zoho_contact_phone",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "matched_zoho_contact_title",
                table: "contacts");
        }
    }
}
