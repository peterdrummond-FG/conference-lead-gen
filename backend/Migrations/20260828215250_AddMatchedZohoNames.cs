using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMatchedZohoNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "matched_zoho_account_name",
                table: "contacts",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "matched_zoho_contact_name",
                table: "contacts",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "matched_zoho_account_name",
                table: "contacts");

            migrationBuilder.DropColumn(
                name: "matched_zoho_contact_name",
                table: "contacts");
        }
    }
}
