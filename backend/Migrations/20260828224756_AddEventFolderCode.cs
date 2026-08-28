using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConferenceLeadGen.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEventFolderCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "folder_code",
                table: "events",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_events_folder_code",
                table: "events",
                column: "folder_code",
                unique: true,
                filter: "folder_code IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_events_folder_code",
                table: "events");

            migrationBuilder.DropColumn(
                name: "folder_code",
                table: "events");
        }
    }
}
